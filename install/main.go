package main

import (
	"bufio"
	"embed"
	"fmt"
	"io"
	"io/fs"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"text/template"
	"time"
)

// DO NOT EDIT THIS FUNCTION; IT MATCHED BY REGEX IN CICD
func loadVersions(config *Config) {
	config.PangolinVersion = "replaceme"
	config.GerbilVersion = "replaceme"
	config.BadgerVersion = "replaceme"
}

//go:embed config/*
var configFiles embed.FS

type Config struct {
	InstallationContainerType SupportedContainer
	PangolinVersion           string
	GerbilVersion             string
	BadgerVersion             string
	BaseDomain                string
	DashboardDomain           string
	EnableIPv6                bool
	LetsEncryptEmail          string
	EnableEmail               bool
	EmailSMTPHost             string
	EmailSMTPPort             int
	EmailSMTPUser             string
	EmailSMTPPass             string
	EmailNoReply              string
	InstallGerbil             bool
	TraefikBouncerKey         string
	DoCrowdsecInstall         bool
	EnableGeoblocking         bool
	Secret                    string
}

type SupportedContainer string

const (
	Docker SupportedContainer = "docker"
	Podman SupportedContainer = "podman"
	Undefined SupportedContainer = "undefined"
)

func main() {

	// print a banner about prerequisites - opening port 80, 443, 51820, and 21820 on the VPS and firewall and pointing your domain to the VPS IP with a records. Docs are at http://localhost:3000/Getting%20Started/dns-networking

	fmt.Println("Welcome to the Pangolin installer!")
	fmt.Println("This installer will help you set up Pangolin on your server.")
	fmt.Println("\nPlease make sure you have the following prerequisites:")
	fmt.Println("- Open TCP ports 80 and 443 and UDP ports 51820 and 21820 on your VPS and firewall.")
	fmt.Println("\nLets get started!")

	if os.Geteuid() == 0 { // WE NEED TO BE SUDO TO CHECK THIS
		for _, p := range []int{80, 443} {
			if err := checkPortsAvailable(p); err != nil {
				fmt.Fprintln(os.Stderr, err)

				fmt.Printf("Please close any services on ports 80/443 in order to run the installation smoothly. If you already have the Pangolin stack running, shut them down before proceeding.\n")
				os.Exit(1)
			}
		}
	}

	reader := bufio.NewReader(os.Stdin)

	var config Config
	var alreadyInstalled = false

	// check if there is already a config file
	if _, err := os.Stat("config/config.yml"); err != nil {
		config = collectUserInput(reader)

		loadVersions(&config)
		config.DoCrowdsecInstall = false
		config.Secret = generateRandomSecretKey()

		fmt.Println("\n=== Generating Configuration Files ===")

		if err := createConfigFiles(config); err != nil {
			fmt.Printf("Error creating config files: %v\n", err)
			os.Exit(1)
		}

		moveFile("config/docker-compose.yml", "docker-compose.yml")

		fmt.Println("\nConfiguration files created successfully!")

		// Download MaxMind database if requested
		if config.EnableGeoblocking {
			fmt.Println("\n=== Downloading MaxMind Database ===")
			if err := downloadMaxMindDatabase(); err != nil {
				fmt.Printf("Error downloading MaxMind database: %v\n", err)
				fmt.Println("You can download it manually later if needed.")
			}
		}

		fmt.Println("\n=== Starting installation ===")

		if readBool(reader, "Would you like to install and start the containers?", true) {

			config.InstallationContainerType = podmanOrDocker(reader)

			if !isDockerInstalled() && runtime.GOOS == "linux" && config.InstallationContainerType == Docker {
				if readBool(reader, "Docker is not installed. Would you like to install it?", true) {
					installDocker()
					// try to start docker service but ignore errors
					if err := startDockerService(); err != nil {
						fmt.Println("Error starting Docker service:", err)
					} else {
						fmt.Println("Docker service started successfully!")
					}
					// wait 10 seconds for docker to start checking if docker is running every 2 seconds
					fmt.Println("Waiting for Docker to start...")
					for i := 0; i < 5; i++ {
						if isDockerRunning() {
							fmt.Println("Docker is running!")
							break
						}
						fmt.Println("Docker is not running yet, waiting...")
						time.Sleep(2 * time.Second)
					}
					if !isDockerRunning() {
						fmt.Println("Docker is still not running after 10 seconds. Please check the installation.")
						os.Exit(1)
					}
					fmt.Println("Docker installed successfully!")
				}
			}

			if err := pullContainers(config.InstallationContainerType); err != nil {
				fmt.Println("Error: ", err)
				return
			}

			if err := startContainers(config.InstallationContainerType); err != nil {
				fmt.Println("Error: ", err)
				return
			}
		}

	} else {
		alreadyInstalled = true
		fmt.Println("Looks like you already installed Pangolin!")
		
		// Check if MaxMind database exists and offer to update it
		fmt.Println("\n=== MaxMind Database Update ===")
		if _, err := os.Stat("config/GeoLite2-Country.mmdb"); err == nil {
			fmt.Println("MaxMind GeoLite2 Country database found.")
			if readBool(reader, "Would you like to update the MaxMind database to the latest version?", false) {
				if err := downloadMaxMindDatabase(); err != nil {
					fmt.Printf("Error updating MaxMind database: %v\n", err)
					fmt.Println("You can try updating it manually later if needed.")
				}
			}
		} else {
			fmt.Println("MaxMind GeoLite2 Country database not found.")
			if readBool(reader, "Would you like to download the MaxMind GeoLite2 database for geoblocking functionality?", false) {
				if err := downloadMaxMindDatabase(); err != nil {
					fmt.Printf("Error downloading MaxMind database: %v\n", err)
					fmt.Println("You can try downloading it manually later if needed.")
				}
				// Now you need to update your config file accordingly to enable geoblocking
				fmt.Println("Please remember to update your config/config.yml file to enable geoblocking! \n")
				// add   maxmind_db_path: "./config/GeoLite2-Country.mmdb" under server
				fmt.Println("Add the following line under the 'server' section:")
				fmt.Println("  maxmind_db_path: \"./config/GeoLite2-Country.mmdb\"")
			}
		}
	}

	if !checkIsCrowdsecInstalledInCompose() {
		fmt.Println("\n=== CrowdSec Install ===")
		// check if crowdsec is installed
		if readBool(reader, "Would you like to install CrowdSec?", false) {
			fmt.Println("This installer constitutes a minimal viable CrowdSec deployment. CrowdSec will add extra complexity to your Pangolin installation and may not work to the best of its abilities out of the box. Users are expected to implement configuration adjustments on their own to achieve the best security posture. Consult the CrowdSec documentation for detailed configuration instructions.")

			// BUG: crowdsec installation will be skipped if the user chooses to install on the first installation.
			if readBool(reader, "Are you willing to manage CrowdSec?", false) {
				if config.DashboardDomain == "" {
					traefikConfig, err := ReadTraefikConfig("config/traefik/traefik_config.yml")
					if err != nil {
						fmt.Printf("Error reading config: %v\n", err)
						return
					}
					appConfig, err := ReadAppConfig("config/config.yml")
					if err != nil {
						fmt.Printf("Error reading config: %v\n", err)
						return
					}

					parsedURL, err := url.Parse(appConfig.DashboardURL)
					if err != nil {
                        fmt.Printf("Error parsing URL: %v\n", err)
                        return
					}

					config.DashboardDomain = parsedURL.Hostname()
					config.LetsEncryptEmail = traefikConfig.LetsEncryptEmail
					config.BadgerVersion = traefikConfig.BadgerVersion

					// print the values and check if they are right
					fmt.Println("Detected values:")
					fmt.Printf("Dashboard Domain: %s\n", config.DashboardDomain)
					fmt.Printf("Let's Encrypt Email: %s\n", config.LetsEncryptEmail)
					fmt.Printf("Badger Version: %s\n", config.BadgerVersion)

					if !readBool(reader, "Are these values correct?", true) {
						config = collectUserInput(reader)
					}
				}

				config.InstallationContainerType = podmanOrDocker(reader)

				config.DoCrowdsecInstall = true
				err := installCrowdsec(config)
				if err != nil {
					fmt.Printf("Error installing CrowdSec: %v\n", err)
					return
				}

				fmt.Println("CrowdSec installed successfully!")
			}
		}
	}

	if !alreadyInstalled {
		// Setup Token Section
		fmt.Println("\n=== Setup Token ===")

		// Check if containers were started during this installation
		containersStarted := false
		if (isDockerInstalled() && config.InstallationContainerType == Docker) ||
			(isPodmanInstalled() && config.InstallationContainerType == Podman) {
			// Try to fetch and display the token if containers are running
			containersStarted = true
			printSetupToken(config.InstallationContainerType, config.DashboardDomain)
		}

		// If containers weren't started or token wasn't found, show instructions
		if !containersStarted {
			showSetupTokenInstructions(config.InstallationContainerType, config.DashboardDomain)
		}
	}

	fmt.Println("\nInstallation complete!")

	fmt.Printf("\nTo complete the initial setup, please visit:\nhttps://%s/auth/initial-setup\n", config.DashboardDomain)
}

func podmanOrDocker(reader *bufio.Reader) SupportedContainer {
	inputContainer := readString(reader, "Would you like to run Pangolin as Docker or Podman containers?", "docker")

	chosenContainer := Docker
	if strings.EqualFold(inputContainer, "docker") {
		chosenContainer = Docker
	} else if strings.EqualFold(inputContainer, "podman") {
		chosenContainer = Podman
	} else {
		fmt.Printf("Unrecognized container type: %s. Valid options are 'docker' or 'podman'.\n", inputContainer)
		os.Exit(1)
	}

	if chosenContainer == Podman {
		if !isPodmanInstalled() {
			fmt.Println("Podman or podman-compose is not installed. Please install both manually. Automated installation will be available in a later release.")
			os.Exit(1)
		}

		if err := exec.Command("bash", "-c", "cat /etc/sysctl.conf | grep 'net.ipv4.ip_unprivileged_port_start='").Run(); err != nil {
			fmt.Println("Would you like to configure ports >= 80 as unprivileged ports? This enables podman containers to listen on low-range ports.")
			fmt.Println("Pangolin will experience startup issues if this is not configured, because it needs to listen on port 80/443 by default.")
			approved := readBool(reader, "The installer is about to execute \"echo 'net.ipv4.ip_unprivileged_port_start=80' >> /etc/sysctl.conf && sysctl -p\". Approve?", true)
			if approved {
				if os.Geteuid() != 0 {
					fmt.Println("You need to run the installer as root for such a configuration.")
					os.Exit(1)
				}

				// Podman containers are not able to listen on privileged ports. The official recommendation is to
				// container low-range ports as unprivileged ports.
				// Linux only.

				if err := run("bash", "-c", "echo 'net.ipv4.ip_unprivileged_port_start=80' >> /etc/sysctl.conf && sysctl -p"); err != nil {
					fmt.Sprintf("failed to configure unprivileged ports: %v.\n", err)
					os.Exit(1)
				}
			} else {
				fmt.Println("You need to configure port forwarding or adjust the listening ports before running pangolin.")
			}
		} else {
			fmt.Println("Unprivileged ports have been configured.")
		}

	} else if chosenContainer == Docker {
		// check if docker is not installed and the user is root
		if !isDockerInstalled() {
			if os.Geteuid() != 0 {
				fmt.Println("Docker is not installed. Please install Docker manually or run this installer as root.")
				os.Exit(1)
			}
		}

		// check if the user is in the docker group (linux only)
		if !isUserInDockerGroup() {
			fmt.Println("You are not in the docker group.")
			fmt.Println("The installer will not be able to run docker commands without running it as root.")
			os.Exit(1)
		}
	} else {
		// This shouldn't happen unless there's a third container runtime.
		os.Exit(1)
	}

	return chosenContainer
}

func collectUserInput(reader *bufio.Reader) Config {
	config := Config{}

	// Basic configuration
	fmt.Println("\n=== Basic Configuration ===")

	config.BaseDomain = readString(reader, "Enter your base domain (no subdomain e.g. example.com)", "")

	// Set default dashboard domain after base domain is collected
	defaultDashboardDomain := ""
	if config.BaseDomain != "" {
		defaultDashboardDomain = "pangolin." + config.BaseDomain
	}
	config.DashboardDomain = readString(reader, "Enter the domain for the Pangolin dashboard", defaultDashboardDomain)
	config.LetsEncryptEmail = readString(reader, "Enter email for Let's Encrypt certificates", "")
	config.InstallGerbil = readBool(reader, "Do you want to use Gerbil to allow tunneled connections", true)

	// Email configuration
	fmt.Println("\n=== Email Configuration ===")
	config.EnableEmail = readBool(reader, "Enable email functionality (SMTP)", false)

	if config.EnableEmail {
		config.EmailSMTPHost = readString(reader, "Enter SMTP host", "")
		config.EmailSMTPPort = readInt(reader, "Enter SMTP port (default 587)", 587)
		config.EmailSMTPUser = readString(reader, "Enter SMTP username", "")
		config.EmailSMTPPass = readString(reader, "Enter SMTP password", "") // Should this be readPassword?
		config.EmailNoReply = readString(reader, "Enter no-reply email address", "")
	}

	// Validate required fields
	if config.BaseDomain == "" {
		fmt.Println("Error: Domain name is required")
		os.Exit(1)
	}
	if config.LetsEncryptEmail == "" {
		fmt.Println("Error: Let's Encrypt email is required")
		os.Exit(1)
	}

	// Advanced configuration

	fmt.Println("\n=== Advanced Configuration ===")

	config.EnableIPv6 = readBool(reader, "Is your server IPv6 capable?", true)
	config.EnableGeoblocking = readBool(reader, "Do you want to download the MaxMind GeoLite2 database for geoblocking functionality?", true)

	if config.DashboardDomain == "" {
		fmt.Println("Error: Dashboard Domain name is required")
		os.Exit(1)
	}

	return config
}

func createConfigFiles(config Config) error {
	os.MkdirAll("config", 0755)
	os.MkdirAll("config/letsencrypt", 0755)
	os.MkdirAll("config/db", 0755)
	os.MkdirAll("config/logs", 0755)

	// Walk through all embedded files
	err := fs.WalkDir(configFiles, "config", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Skip the root fs directory itself
		if path == "config" {
			return nil
		}

		if !config.DoCrowdsecInstall && strings.Contains(path, "crowdsec") {
			return nil
		}

		if config.DoCrowdsecInstall && !strings.Contains(path, "crowdsec") {
			return nil
		}

		// skip .DS_Store
		if strings.Contains(path, ".DS_Store") {
			return nil
		}

		if d.IsDir() {
			// Create directory
			if err := os.MkdirAll(path, 0755); err != nil {
				return fmt.Errorf("failed to create directory %s: %v", path, err)
			}
			return nil
		}

		// Read the template file
		content, err := configFiles.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read %s: %v", path, err)
		}

		// Parse template
		tmpl, err := template.New(d.Name()).Parse(string(content))
		if err != nil {
			return fmt.Errorf("failed to parse template %s: %v", path, err)
		}

		// Ensure parent directory exists
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return fmt.Errorf("failed to create parent directory for %s: %v", path, err)
		}

		// Create output file
		outFile, err := os.Create(path)
		if err != nil {
			return fmt.Errorf("failed to create %s: %v", path, err)
		}
		defer outFile.Close()

		// Execute template
		if err := tmpl.Execute(outFile, config); err != nil {
			return fmt.Errorf("failed to execute template %s: %v", path, err)
		}

		return nil
	})
	if err != nil {
		return fmt.Errorf("error walking config files: %v", err)
	}

	return nil
}

func copyFile(src, dst string) error {
	source, err := os.Open(src)
	if err != nil {
		return err
	}
	defer source.Close()

	destination, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destination.Close()

	_, err = io.Copy(destination, source)
	return err
}

func moveFile(src, dst string) error {
	if err := copyFile(src, dst); err != nil {
		return err
	}

	return os.Remove(src)
}

func printSetupToken(containerType SupportedContainer, dashboardDomain string) {
	fmt.Println("Waiting for Pangolin to generate setup token...")

	// Wait for Pangolin to be healthy
	if err := waitForContainer("pangolin", containerType); err != nil {
		fmt.Println("Warning: Pangolin container did not become healthy in time.")
		return
	}

	// Give a moment for the setup token to be generated
	time.Sleep(2 * time.Second)

	// Fetch logs
	var cmd *exec.Cmd
	if containerType == Docker {
		cmd = exec.Command("docker", "logs", "pangolin")
	} else {
		cmd = exec.Command("podman", "logs", "pangolin")
	}
	output, err := cmd.Output()
	if err != nil {
		fmt.Println("Warning: Could not fetch Pangolin logs to find setup token.")
		return
	}

	// Parse for setup token
	lines := strings.Split(string(output), "\n")
	for i, line := range lines {
		if strings.Contains(line, "=== SETUP TOKEN GENERATED ===") || strings.Contains(line, "=== SETUP TOKEN EXISTS ===") {
			// Look for "Token: ..." in the next few lines
			for j := i + 1; j < i+5 && j < len(lines); j++ {
				trimmedLine := strings.TrimSpace(lines[j])
				if strings.Contains(trimmedLine, "Token:") {
					// Extract token after "Token:"
					tokenStart := strings.Index(trimmedLine, "Token:")
					if tokenStart != -1 {
						token := strings.TrimSpace(trimmedLine[tokenStart+6:])
						fmt.Printf("Setup token: %s\n", token)
						fmt.Println("")
						fmt.Println("This token is required to register the first admin account in the web UI at:")
						fmt.Printf("https://%s/auth/initial-setup\n", dashboardDomain)
						fmt.Println("")
						fmt.Println("Save this token securely. It will be invalid after the first admin is created.")
						return
					}
				}
			}
		}
	}
	fmt.Println("Warning: Could not find a setup token in Pangolin logs.")
}

func showSetupTokenInstructions(containerType SupportedContainer, dashboardDomain string) {
	fmt.Println("\n=== Setup Token Instructions ===")
	fmt.Println("To get your setup token, you need to:")
	fmt.Println("")
	fmt.Println("1. Start the containers")
	if containerType == Docker {
		fmt.Println("   docker compose up -d")
	} else if containerType == Podman {
		fmt.Println("   podman-compose up -d")
	} else {
	}
	fmt.Println("")
	fmt.Println("2. Wait for the Pangolin container to start and generate the token")
	fmt.Println("")
	fmt.Println("3. Check the container logs for the setup token")
	if containerType == Docker {
		fmt.Println("   docker logs pangolin | grep -A 2 -B 2 'SETUP TOKEN'")
	} else if containerType == Podman {
		fmt.Println("   podman logs pangolin | grep -A 2 -B 2 'SETUP TOKEN'")
	} else {
	}
	fmt.Println("")
	fmt.Println("4. Look for output like")
	fmt.Println("   === SETUP TOKEN GENERATED ===")
	fmt.Println("   Token: [your-token-here]")
	fmt.Println("   Use this token on the initial setup page")
	fmt.Println("")
	fmt.Println("5. Use the token to complete initial setup at")
	fmt.Printf("   https://%s/auth/initial-setup\n", dashboardDomain)
	fmt.Println("")
	fmt.Println("The setup token is required to register the first admin account.")
	fmt.Println("Save it securely - it will be invalid after the first admin is created.")
	fmt.Println("================================")
}

func generateRandomSecretKey() string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	const length = 32

	var seededRand *rand.Rand = rand.New(
		rand.NewSource(time.Now().UnixNano()))

	b := make([]byte, length)
	for i := range b {
		b[i] = charset[seededRand.Intn(len(charset))]
	}
	return string(b)
}

func getPublicIP() string {
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	resp, err := client.Get("https://ifconfig.io/ip")
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return ""
	}

	ip := strings.TrimSpace(string(body))

	// Validate that it's a valid IP address
	if net.ParseIP(ip) != nil {
		return ip
	}

	return ""
}

// Run external commands with stdio/stderr attached.
func run(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func checkPortsAvailable(port int) error {
	addr := fmt.Sprintf(":%d", port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf(
			"ERROR: port %d is occupied or cannot be bound: %w\n\n",
			port, err,
		)
	}
	if closeErr := ln.Close(); closeErr != nil {
		fmt.Fprintf(os.Stderr,
			"WARNING: failed to close test listener on port %d: %v\n",
			port, closeErr,
		)
	}
	return nil
}

func downloadMaxMindDatabase() error {
	fmt.Println("Downloading MaxMind GeoLite2 Country database...")
	
	// Download the GeoLite2 Country database
	if err := run("curl", "-L", "-o", "GeoLite2-Country.tar.gz", 
		"https://github.com/GitSquared/node-geolite2-redist/raw/refs/heads/master/redist/GeoLite2-Country.tar.gz"); err != nil {
		return fmt.Errorf("failed to download GeoLite2 database: %v", err)
	}
	
	// Extract the database
	if err := run("tar", "-xzf", "GeoLite2-Country.tar.gz"); err != nil {
		return fmt.Errorf("failed to extract GeoLite2 database: %v", err)
	}
	
	// Find the .mmdb file and move it to the config directory
	if err := run("bash", "-c", "mv GeoLite2-Country_*/GeoLite2-Country.mmdb config/"); err != nil {
		return fmt.Errorf("failed to move GeoLite2 database to config directory: %v", err)
	}
	
	// Clean up the downloaded files
	if err := run("rm", "-rf", "GeoLite2-Country.tar.gz", "GeoLite2-Country_*"); err != nil {
		fmt.Printf("Warning: failed to clean up temporary files: %v\n", err)
	}
	
	fmt.Println("MaxMind GeoLite2 Country database downloaded successfully!")
	return nil
}
