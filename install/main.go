package main

import (
	"crypto/rand"
	"embed"
	"encoding/base64"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"text/template"
	"time"
)

// Version variables injected at build time via -ldflags
var (
	pangolinVersion string
	gerbilVersion   string
	badgerVersion   string
)

func loadVersions(config *Config) {
	config.PangolinVersion = pangolinVersion
	config.GerbilVersion = gerbilVersion
	config.BadgerVersion = badgerVersion
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
	EnableMaxMind             bool
	Secret                    string
	IsEnterprise              bool
    IsPostgreSQL              bool
	IsPostgreSQLPass          string
    IsRedis                   bool
	IsRedisPass               string
}

type SupportedContainer string

const (
	Docker    SupportedContainer = "docker"
	Podman    SupportedContainer = "podman"
	Undefined SupportedContainer = "undefined"
)

var redisFlag *bool

func main() {

	crowdsecFlag := flag.Bool("crowdsec", false, "Enable the CrowdSec installation prompt")
	redisFlag = flag.Bool("redis", false, "Install Redis as cacheing solution. Required for HA. Not required for the Enterprise version.")
	flag.Parse()

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

	var config Config
	var alreadyInstalled = false

	// Determine installation directory
	installDir := findOrSelectInstallDirectory()
	if err := os.Chdir(installDir); err != nil {
		fmt.Printf("Error changing to installation directory: %v\n", err)
		os.Exit(1)
	}

	// check if there is already a config file
	if _, err := os.Stat("config/config.yml"); err != nil {
		config = collectUserInput()

		loadVersions(&config)
		config.DoCrowdsecInstall = false
		config.Secret = generateRandomSecretKey()

		fmt.Println("\n=== Generating Configuration Files ===")

		if err := createConfigFiles(config); err != nil {
			fmt.Printf("Error creating config files: %v\n", err)
			os.Exit(1)
		}

		if err := moveFile("config/docker-compose.yml", "docker-compose.yml"); err != nil {
			fmt.Printf("Error moving docker-compose.yml: %v\n", err)
			os.Exit(1)
		}

		fmt.Println("\nConfiguration files created successfully!")

		// Download MaxMind Country / ASN database if requested
		if config.EnableMaxMind {
			fmt.Println("\n=== Downloading MaxMind Country and ASN Databases ===")
			if err := downloadMaxMindDatabase(); err != nil {
				fmt.Printf("Error downloading MaxMind databases: %v\n", err)
				fmt.Println("You can download it manually later if needed.")
			}
		}

		fmt.Println("\n=== Starting installation ===")

		if readBool("Would you like to install and start the containers?", true) {

			config.InstallationContainerType = podmanOrDocker()

			if !isDockerInstalled() && runtime.GOOS == "linux" && config.InstallationContainerType == Docker {
				if readBool("Docker is not installed. Would you like to install it?", true) {
					if err := installDocker(); err != nil {
						fmt.Printf("Error installing Docker: %v\n", err)
						return
					}

					// try to start docker service but ignore errors
					if err := startDockerService(); err != nil {
						fmt.Println("Error starting Docker service:", err)
					} else {
						fmt.Println("Docker service started successfully!")
					}
					// wait 10 seconds for docker to start checking if docker is running every 2 seconds
					fmt.Println("Waiting for Docker to start...")
					for range 5 {
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
			if readBool("Would you like to update the MaxMind databases (Country and ASN) to the latest version?", false) {
				if err := downloadMaxMindDatabase(); err != nil {
					fmt.Printf("Error updating MaxMind database: %v\n", err)
					fmt.Println("You can try updating it manually later if needed.")
				}
			}
		} else {
			fmt.Println("MaxMind GeoLite2 Country and ASN databases not found.")
			if readBool("Would you like to download the MaxMind GeoLite2 databases for blocking functionality?", false) {
				if err := downloadMaxMindDatabase(); err != nil {
					fmt.Printf("Error downloading MaxMind database: %v\n", err)
					fmt.Println("You can try downloading it manually later if needed.")
				}
				// Now you need to update your config file accordingly to enable geoblocking
				fmt.Print("Please remember to update your config/config.yml file to enable geoblocking! \n\n")
				// add   maxmind_db_path: "./config/GeoLite2-Country.mmdb" under server
				// add   maxmind_asn_path: "./config/GeoLite2-ASN.mmdb" under server
				fmt.Println("Add the following lines under the 'server' section:")
				fmt.Println("  maxmind_db_path: \"./config/GeoLite2-Country.mmdb\"")
				fmt.Println("  maxmind_asn_path: \"./config/GeoLite2-ASN.mmdb\"")
			}
		}
	}

	if *crowdsecFlag && !checkIsCrowdsecInstalledInCompose() {
		fmt.Println("\n=== CrowdSec Install ===")
		// check if crowdsec is installed
		if readBool("Would you like to install CrowdSec?", false) {
			fmt.Println("This installer constitutes a minimal viable CrowdSec deployment. CrowdSec will add extra complexity to your Pangolin installation and may not work to the best of its abilities out of the box. Users are expected to implement configuration adjustments on their own to achieve the best security posture. Consult the CrowdSec documentation for detailed configuration instructions.")

			// BUG: crowdsec installation will be skipped if the user chooses to install on the first installation.
			if readBool("Are you willing to manage CrowdSec?", false) {
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

					if !readBool("Are these values correct?", true) {
						config = collectUserInput()
					}
				}

				// Try to detect container type from existing installation
				detectedType := detectContainerType()
				if detectedType == Undefined {
					// If detection fails, prompt the user
					fmt.Println("Unable to detect container type from existing installation.")
					config.InstallationContainerType = podmanOrDocker()
				} else {
					config.InstallationContainerType = detectedType
					fmt.Printf("Detected container type: %s\n", config.InstallationContainerType)
				}

				config.DoCrowdsecInstall = true
				err := installCrowdsec(config, installDir)
				if err != nil {
					fmt.Printf("Error installing CrowdSec: %v\n", err)
					return
				}

				fmt.Println("CrowdSec installed successfully!")
			}
		}
	}

	if !alreadyInstalled || config.DoCrowdsecInstall {
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

func hasExistingInstall(dir string) bool {
	configPath := filepath.Join(dir, "config", "config.yml")
	_, err := os.Stat(configPath)
	return err == nil
}

func findOrSelectInstallDirectory() string {
	const defaultInstallDir = "/opt/pangolin"

	// Get current working directory
	cwd, err := os.Getwd()
	if err != nil {
		fmt.Printf("Error getting current directory: %v\n", err)
		os.Exit(1)
	}

	// 1. Check current directory for existing install
	if hasExistingInstall(cwd) {
		fmt.Printf("Found existing Pangolin installation in current directory: %s\n", cwd)
		return cwd
	}

	// 2. Check default location (/opt/pangolin) for existing install
	if cwd != defaultInstallDir && hasExistingInstall(defaultInstallDir) {
		fmt.Printf("\nFound existing Pangolin installation at: %s\n", defaultInstallDir)
		if readBool(fmt.Sprintf("Would you like to use the existing installation at %s?", defaultInstallDir), true) {
			return defaultInstallDir
		}
	}

	// 3. No existing install found, prompt for installation directory
	fmt.Println("\n=== Installation Directory ===")
	fmt.Println("No existing Pangolin installation detected.")

	installDir := readString("Enter the installation directory", defaultInstallDir)

	// Expand ~ to home directory if present
	if strings.HasPrefix(installDir, "~") {
		home, err := os.UserHomeDir()
		if err != nil {
			fmt.Printf("Error getting home directory: %v\n", err)
			os.Exit(1)
		}
		installDir = filepath.Join(home, installDir[1:])
	}

	// Convert to absolute path
	absPath, err := filepath.Abs(installDir)
	if err != nil {
		fmt.Printf("Error resolving path: %v\n", err)
		os.Exit(1)
	}
	installDir = absPath

	// Check if directory exists
	if _, err := os.Stat(installDir); os.IsNotExist(err) {
		// Directory doesn't exist, create it
		if readBool(fmt.Sprintf("Directory %s does not exist. Create it?", installDir), true) {
			if err := os.MkdirAll(installDir, 0755); err != nil {
				fmt.Printf("Error creating directory: %v\n", err)
				os.Exit(1)
			}
			fmt.Printf("Created directory: %s\n", installDir)

			// Offer to change ownership if running via sudo
			changeDirectoryOwnership(installDir)
		} else {
			fmt.Println("Installation cancelled.")
			os.Exit(0)
		}
	}

	fmt.Printf("Installation directory: %s\n", installDir)
	return installDir
}

func changeDirectoryOwnership(dir string) {
	// Check if we're running via sudo by looking for SUDO_USER
	sudoUser := os.Getenv("SUDO_USER")
	if sudoUser == "" || os.Geteuid() != 0 {
		return
	}

	sudoUID := os.Getenv("SUDO_UID")
	sudoGID := os.Getenv("SUDO_GID")

	if sudoUID == "" || sudoGID == "" {
		return
	}

	fmt.Printf("\nRunning as root via sudo (original user: %s)\n", sudoUser)
	if readBool(fmt.Sprintf("Would you like to change ownership of %s to user '%s'? This makes it easier to manage config files without sudo.", dir, sudoUser), true) {
		uid, err := strconv.Atoi(sudoUID)
		if err != nil {
			fmt.Printf("Warning: Could not parse SUDO_UID: %v\n", err)
			return
		}
		gid, err := strconv.Atoi(sudoGID)
		if err != nil {
			fmt.Printf("Warning: Could not parse SUDO_GID: %v\n", err)
			return
		}

		if err := os.Chown(dir, uid, gid); err != nil {
			fmt.Printf("Warning: Could not change ownership: %v\n", err)
		} else {
			fmt.Printf("Changed ownership of %s to %s\n", dir, sudoUser)
		}
	}
}

func podmanOrDocker() SupportedContainer {
	inputContainer := readString("Would you like to run Pangolin as Docker or Podman containers?", "docker")

	chosenContainer := Docker
	if strings.EqualFold(inputContainer, "docker") {
		chosenContainer = Docker
	} else if strings.EqualFold(inputContainer, "podman") {
		chosenContainer = Podman
	} else {
		fmt.Printf("Unrecognized container type: %s. Valid options are 'docker' or 'podman'.\n", inputContainer)
		os.Exit(1)
	}

	switch chosenContainer {
	case Podman:
		if !isPodmanInstalled() {
			fmt.Println("Podman or podman-compose is not installed. Please install both manually. Automated installation will be available in a later release.")
			os.Exit(1)
		}

		if err := exec.Command("bash", "-c", "cat /etc/sysctl.d/99-podman.conf 2>/dev/null | grep 'net.ipv4.ip_unprivileged_port_start=' || cat /etc/sysctl.conf 2>/dev/null | grep 'net.ipv4.ip_unprivileged_port_start='").Run(); err != nil {
			fmt.Println("Would you like to configure ports >= 80 as unprivileged ports? This enables podman containers to listen on low-range ports.")
			fmt.Println("Pangolin will experience startup issues if this is not configured, because it needs to listen on port 80/443 by default.")
			approved := readBool("The installer is about to execute \"echo 'net.ipv4.ip_unprivileged_port_start=80' > /etc/sysctl.d/99-podman.conf && sysctl --system\". Approve?", true)
			if approved {
				if os.Geteuid() != 0 {
					fmt.Println("You need to run the installer as root for such a configuration.")
					os.Exit(1)
				}

				// Podman containers are not able to listen on privileged ports. The official recommendation is to
				// container low-range ports as unprivileged ports.
				// Linux only.

				if err := run("bash", "-c", "echo 'net.ipv4.ip_unprivileged_port_start=80' > /etc/sysctl.d/99-podman.conf && sysctl --system"); err != nil {
					fmt.Printf("Error configuring unprivileged ports: %v\n", err)
					os.Exit(1)
				}
			} else {
				fmt.Println("You need to configure port forwarding or adjust the listening ports before running pangolin.")
			}
		} else {
			fmt.Println("Unprivileged ports have been configured.")
		}

	case Docker:
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
	default:
		// This shouldn't happen unless there's a third container runtime.
		os.Exit(1)
	}

	return chosenContainer
}

func collectUserInput() Config {
	config := Config{}

	// Basic configuration
	fmt.Println("\n=== Basic Configuration ===")

	config.IsEnterprise = readBoolNoDefault("Do you want to install the Enterprise version of Pangolin? The EE is free for personal use or for businesses making less than 100k USD annually.")
    if config.IsEnterprise {
        if *redisFlag {
			config.IsRedis = true
            config.IsRedisPass = readPassword("Enter a unique password for the Redis service.")
        }
    }

    config.IsPostgreSQL = readBool("Do you want to use PostgreSQL (not recommended for most users)?", false)
	if config.IsPostgreSQL {
		config.IsPostgreSQLPass = readPassword("Enter a unique password for the PostgreSQL pangolin user.")
	}

	config.BaseDomain = readString("Enter your base domain (no subdomain e.g. example.com)", "")

	// Set default dashboard domain after base domain is collected
	defaultDashboardDomain := ""
	if config.BaseDomain != "" {
		defaultDashboardDomain = "pangolin." + config.BaseDomain
	}
	config.DashboardDomain = readString("Enter the domain for the Pangolin dashboard", defaultDashboardDomain)
	config.LetsEncryptEmail = readString("Enter email for Let's Encrypt certificates", "")
	config.InstallGerbil = readBool("Do you want to use Gerbil to allow tunneled connections", true)

	// Email configuration
	fmt.Println("\n=== Email Configuration ===")
	config.EnableEmail = readBool("Enable email functionality (SMTP)", false)

	if config.EnableEmail {
		config.EmailSMTPHost = readString("Enter SMTP host", "")
		config.EmailSMTPPort = readInt("Enter SMTP port (default 587)", 587)
		config.EmailSMTPUser = readString("Enter SMTP username", "")
		config.EmailSMTPPass = readPassword("Enter SMTP password")
		config.EmailNoReply = readString("Enter no-reply email address (often the same as SMTP username)", "")
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
	if config.EnableEmail && config.EmailNoReply == "" {
		fmt.Println("Error: No-reply email address is required when email is enabled")
		os.Exit(1)
	}

	// Advanced configuration

	fmt.Println("\n=== Advanced Configuration ===")

	config.EnableIPv6 = readBool("Is your server IPv6 capable?", true)
	config.EnableMaxMind = readBool("Do you want to download the MaxMind GeoLite2 Country and ASN databases for blocking functionality?", true)

	if config.DashboardDomain == "" {
		fmt.Println("Error: Dashboard Domain name is required")
		os.Exit(1)
	}

	return config
}

func createConfigFiles(config Config) error {
	if err := os.MkdirAll("config", 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %v", err)
	}
	if err := os.MkdirAll("config/letsencrypt", 0755); err != nil {
		return fmt.Errorf("failed to create letsencrypt directory: %v", err)
	}
	if err := os.MkdirAll("config/db", 0755); err != nil {
		return fmt.Errorf("failed to create db directory: %v", err)
	}
	if err := os.MkdirAll("config/logs", 0755); err != nil {
		return fmt.Errorf("failed to create logs directory: %v", err)
	}

	// Walk through all embedded files
	err := fs.WalkDir(configFiles, "config", func(path string, d fs.DirEntry, walkErr error) (err error) {
		if walkErr != nil {
			return walkErr
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
		defer func() {
			if cerr := outFile.Close(); cerr != nil && err == nil {
				err = cerr
			}
		}()

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

func copyFile(src, dst string) (err error) {
	source, err := os.Open(src)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := source.Close(); cerr != nil && err == nil {
			err = cerr
		}
	}()

	destination, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := destination.Close(); cerr != nil && err == nil {
			err = cerr
		}
	}()

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
	switch containerType {
	case Docker:
		fmt.Println("   docker compose up -d")
	case Podman:
		fmt.Println("   podman-compose up -d")
	}

	fmt.Println("")
	fmt.Println("2. Wait for the Pangolin container to start and generate the token")
	fmt.Println("")
	fmt.Println("3. Check the container logs for the setup token")
	switch containerType {
	case Docker:
		fmt.Println("   docker logs pangolin | grep -A 2 -B 2 'SETUP TOKEN'")
	case Podman:
		fmt.Println("   podman logs pangolin | grep -A 2 -B 2 'SETUP TOKEN'")
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
	secret := make([]byte, 32)
	_, err := rand.Read(secret)
	if err != nil {
		panic(fmt.Sprintf("Failed to generate random secret key: %v", err))
	}
	return base64.StdEncoding.EncodeToString(secret)
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
		return fmt.Errorf("ERROR: port %d is occupied or cannot be bound: %w", port, err)
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
	fmt.Println("Downloading MaxMind GeoLite2 Country and ASN databases...")

	// Download the GeoLite2 Country databases
	if err := run("curl", "-L", "-o", "GeoLite2-Country.tar.gz",
		"https://github.com/GitSquared/node-geolite2-redist/raw/refs/heads/master/redist/GeoLite2-Country.tar.gz"); err != nil {
		return fmt.Errorf("failed to download GeoLite2 Country database: %v", err)
	}
	if err := run("curl", "-L", "-o", "GeoLite2-ASN.tar.gz",
		"https://github.com/GitSquared/node-geolite2-redist/raw/refs/heads/master/redist/GeoLite2-ASN.tar.gz"); err != nil {
		return fmt.Errorf("failed to download GeoLite2 ASN database: %v", err)
	}

	// Extract the Country database
	if err := run("tar", "-xzf", "GeoLite2-Country.tar.gz"); err != nil {
		return fmt.Errorf("failed to extract GeoLite2 Country database: %v", err)
	}
	if err := run("tar", "-xzf", "GeoLite2-ASN.tar.gz"); err != nil {
		return fmt.Errorf("failed to extract GeoLite2 ASN database: %v", err)
	}

	// Find the .mmdb file and move it to the config directory
	if err := run("bash", "-c", "mv GeoLite2-Country_*/GeoLite2-Country.mmdb config/"); err != nil {
		return fmt.Errorf("failed to move GeoLite2 Country database to config directory: %v", err)
	}
	if err := run("bash", "-c", "mv GeoLite2-ASN_*/GeoLite2-ASN.mmdb config/"); err != nil {
		return fmt.Errorf("failed to move GeoLite2 ASN database to config directory: %v", err)
	}

	// Clean up the downloaded files
	if err := run("sh", "-c", "rm -rf GeoLite2-Country.tar.gz GeoLite2-Country_*"); err != nil {
		fmt.Printf("Warning: failed to clean up temporary country files: %v\n", err)
	}
	if err := run("sh", "-c", "rm -rf GeoLite2-ASN.tar.gz GeoLite2-ASN_*"); err != nil {
		fmt.Printf("Warning: failed to clean up temporary ASN files: %v\n", err)
	}

	fmt.Println("MaxMind GeoLite2 Country and ASN database downloaded successfully!")
	return nil
}
