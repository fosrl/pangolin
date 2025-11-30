package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"runtime"
	"strconv"
	"strings"
	"time"
)

func waitForContainer(containerName string, containerType SupportedContainer) error {
	maxAttempts := 30
	retryInterval := time.Second * 2

	for attempt := 0; attempt < maxAttempts; attempt++ {
		// Check if container is running
		cmd := exec.Command(string(containerType), "container", "inspect", "-f", "{{.State.Running}}", containerName)
		var out bytes.Buffer
		cmd.Stdout = &out

		if err := cmd.Run(); err != nil {
			// If the container doesn't exist or there's another error, wait and retry
			time.Sleep(retryInterval)
			continue
		}

		isRunning := strings.TrimSpace(out.String()) == "true"
		if isRunning {
			return nil
		}

		// Container exists but isn't running yet, wait and retry
		time.Sleep(retryInterval)
	}

	return fmt.Errorf("container %s did not start within %v seconds", containerName, maxAttempts*int(retryInterval.Seconds()))
}

func installDocker() error {
	// Detect Linux distribution
	cmd := exec.Command("cat", "/etc/os-release")
	output, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("failed to detect Linux distribution: %v", err)
	}
	osRelease := string(output)

	// Detect system architecture
	archCmd := exec.Command("uname", "-m")
	archOutput, err := archCmd.Output()
	if err != nil {
		return fmt.Errorf("failed to detect system architecture: %v", err)
	}
	arch := strings.TrimSpace(string(archOutput))

	// Map architecture to Docker's architecture naming
	var dockerArch string
	switch arch {
	case "x86_64":
		dockerArch = "amd64"
	case "aarch64":
		dockerArch = "arm64"
	default:
		return fmt.Errorf("unsupported architecture: %s", arch)
	}

	var installCmd *exec.Cmd
	switch {
	case strings.Contains(osRelease, "ID=ubuntu"):
		installCmd = exec.Command("bash", "-c", fmt.Sprintf(`
			apt-get update &&
			apt-get install -y apt-transport-https ca-certificates curl &&
			curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg &&
			echo "deb [arch=%s signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list &&
			apt-get update &&
			apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
		`, dockerArch))
	case strings.Contains(osRelease, "ID=debian"):
		installCmd = exec.Command("bash", "-c", fmt.Sprintf(`
			apt-get update &&
			apt-get install -y apt-transport-https ca-certificates curl &&
			curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg &&
			echo "deb [arch=%s signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list &&
			apt-get update &&
			apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
		`, dockerArch))
	case strings.Contains(osRelease, "ID=fedora"):
		// Detect Fedora version to handle DNF 5 changes
		versionCmd := exec.Command("bash", "-c", "grep VERSION_ID /etc/os-release | cut -d'=' -f2 | tr -d '\"'")
		versionOutput, err := versionCmd.Output()
		var fedoraVersion int
		if err == nil {
			if v, parseErr := strconv.Atoi(strings.TrimSpace(string(versionOutput))); parseErr == nil {
				fedoraVersion = v
			}
		}

		// Use appropriate DNF syntax based on version
		var repoCmd string
		if fedoraVersion >= 41 {
			// DNF 5 syntax for Fedora 41+
			repoCmd = "dnf config-manager addrepo --from-repofile=https://download.docker.com/linux/fedora/docker-ce.repo"
		} else {
			// DNF 4 syntax for Fedora < 41
			repoCmd = "dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo"
		}

		installCmd = exec.Command("bash", "-c", fmt.Sprintf(`
			dnf -y install dnf-plugins-core &&
			%s &&
			dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
		`, repoCmd))
	case strings.Contains(osRelease, "ID=opensuse") || strings.Contains(osRelease, "ID=\"opensuse-"):
		installCmd = exec.Command("bash", "-c", `
			zypper install -y docker docker-compose &&
			systemctl enable docker
		`)
	case strings.Contains(osRelease, "ID=rhel") || strings.Contains(osRelease, "ID=\"rhel"):
		installCmd = exec.Command("bash", "-c", `
			dnf remove -y runc &&
			dnf -y install yum-utils &&
			dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo &&
			dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin &&
			systemctl enable docker
		`)
	case strings.Contains(osRelease, "ID=amzn"):
		installCmd = exec.Command("bash", "-c", `
			yum update -y &&
			yum install -y docker &&
			systemctl enable docker &&
			usermod -a -G docker ec2-user
		`)
	default:
		return fmt.Errorf("unsupported Linux distribution")
	}

	installCmd.Stdout = os.Stdout
	installCmd.Stderr = os.Stderr
	return installCmd.Run()
}

func startDockerService() error {
	if runtime.GOOS == "linux" {
		cmd := exec.Command("systemctl", "enable", "--now", "docker")
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		return cmd.Run()
	} else if runtime.GOOS == "darwin" {
		// On macOS, Docker is usually started via the Docker Desktop application
		fmt.Println("Please start Docker Desktop manually on macOS.")
		return nil
	}
	return fmt.Errorf("unsupported operating system for starting Docker service")
}

func isDockerInstalled() bool {
	return isContainerInstalled("docker")
}

func isPodmanInstalled() bool {
	return isContainerInstalled("podman") && isContainerInstalled("podman-compose")
}

func isContainerInstalled(container string) bool {
	cmd := exec.Command(container, "--version")
	if err := cmd.Run(); err != nil {
		return false
	}
	return true
}

func isUserInDockerGroup() bool {
	if runtime.GOOS == "darwin" {
		// Docker group is not applicable on macOS
		// So we assume that the user can run Docker commands
		return true
	}

	if os.Geteuid() == 0 {
		return true // Root user can run Docker commands anyway
	}

	// Check if the current user is in the docker group
	if dockerGroup, err := user.LookupGroup("docker"); err == nil {
		if currentUser, err := user.Current(); err == nil {
			if currentUserGroupIds, err := currentUser.GroupIds(); err == nil {
				for _, groupId := range currentUserGroupIds {
					if groupId == dockerGroup.Gid {
						return true
					}
				}
			}
		}
	}

	// Eventually, if any of the checks fail, we assume the user cannot run Docker commands
	return false
}

// isDockerRunning checks if the Docker daemon is running by using the `docker info` command.
func isDockerRunning() bool {
	cmd := exec.Command("docker", "info")
	if err := cmd.Run(); err != nil {
		return false
	}
	return true
}

// executeDockerComposeCommandWithArgs executes the appropriate docker command with arguments supplied
func executeDockerComposeCommandWithArgs(args ...string) error {
	var cmd *exec.Cmd
	var useNewStyle bool

	if !isDockerInstalled() {
		return fmt.Errorf("docker is not installed")
	}

	checkCmd := exec.Command("docker", "compose", "version")
	if err := checkCmd.Run(); err == nil {
		useNewStyle = true
	} else {
		checkCmd = exec.Command("docker-compose", "version")
		if err := checkCmd.Run(); err == nil {
			useNewStyle = false
		} else {
			return fmt.Errorf("neither 'docker compose' nor 'docker-compose' command is available")
		}
	}

	if useNewStyle {
		cmd = exec.Command("docker", append([]string{"compose"}, args...)...)
	} else {
		cmd = exec.Command("docker-compose", args...)
	}

	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// pullContainers pulls the containers using the appropriate command.
func pullContainers(containerType SupportedContainer) error {
	fmt.Println("Pulling the container images...")
	if containerType == Podman {
		if err := run("podman-compose", "-f", "docker-compose.yml", "pull"); err != nil {
			return fmt.Errorf("failed to pull the containers: %v", err)
		}

		return nil
	}

	if containerType == Docker {
		if err := executeDockerComposeCommandWithArgs("-f", "docker-compose.yml", "pull", "--policy", "always"); err != nil {
			return fmt.Errorf("failed to pull the containers: %v", err)
		}

		return nil
	}

	return fmt.Errorf("Unsupported container type: %s", containerType)
}

// startContainers starts the containers using the appropriate command.
func startContainers(containerType SupportedContainer) error {
	fmt.Println("Starting containers...")

	if containerType == Podman {
		if err := run("podman-compose", "-f", "docker-compose.yml", "up", "-d", "--force-recreate"); err != nil {
			return fmt.Errorf("failed start containers: %v", err)
		}

		return nil
	}

	if containerType == Docker {
		if err := executeDockerComposeCommandWithArgs("-f", "docker-compose.yml", "up", "-d", "--force-recreate"); err != nil {
			return fmt.Errorf("failed to start containers: %v", err)
		}

		return nil
	}

	return fmt.Errorf("Unsupported container type: %s", containerType)
}

// stopContainers stops the containers using the appropriate command.
func stopContainers(containerType SupportedContainer) error {
	fmt.Println("Stopping containers...")
	if containerType == Podman {
		if err := run("podman-compose", "-f", "docker-compose.yml", "down"); err != nil {
			return fmt.Errorf("failed to stop containers: %v", err)
		}

		return nil
	}

	if containerType == Docker {
		if err := executeDockerComposeCommandWithArgs("-f", "docker-compose.yml", "down"); err != nil {
			return fmt.Errorf("failed to stop containers: %v", err)
		}

		return nil
	}

	return fmt.Errorf("Unsupported container type: %s", containerType)
}

// restartContainer restarts a specific container using the appropriate command.
func restartContainer(container string, containerType SupportedContainer) error {
	fmt.Println("Restarting containers...")
	if containerType == Podman {
		if err := run("podman-compose", "-f", "docker-compose.yml", "restart"); err != nil {
			return fmt.Errorf("failed to stop the container \"%s\": %v", container, err)
		}

		return nil
	}

	if containerType == Docker {
		if err := executeDockerComposeCommandWithArgs("-f", "docker-compose.yml", "restart", container); err != nil {
			return fmt.Errorf("failed to stop the container \"%s\": %v", container, err)
		}

		return nil
	}

	return fmt.Errorf("Unsupported container type: %s", containerType)
}
