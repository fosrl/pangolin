package main

import (
	"flag"
	"fmt"
	"os"
)

// Command line flags that pre-answer installer prompts. Any flag that is set
// explicitly skips its prompt; with --non-interactive every remaining prompt
// takes its default value (or fails if it has none), so the installer can be
// driven from scripts such as cloud-init or an AMI first-boot service.
var (
	crowdsecFlag       *bool
	redisFlag          *bool
	nonInteractiveFlag *bool

	installDirFlag      *string
	containerTypeFlag   *string
	startContainersFlag *bool

	enterpriseFlag       *bool
	postgresFlag         *bool
	postgresPasswordFlag *string
	redisPasswordFlag    *string
	baseDomainFlag       *string
	dashboardDomainFlag  *string
	letsEncryptEmailFlag *string
	gerbilFlag           *bool
	ipv6Flag             *bool
	maxmindFlag          *bool

	emailFlag       *bool
	smtpHostFlag    *string
	smtpPortFlag    *int
	smtpUserFlag    *string
	smtpPassFlag    *string
	smtpNoReplyFlag *string
)

// setFlags records which flags were passed explicitly on the command line.
var setFlags = map[string]bool{}

func parseFlags() {
	crowdsecFlag = flag.Bool("crowdsec", false, "Enable the CrowdSec installation prompt")
	redisFlag = flag.Bool("redis", false, "Install Redis as caching solution. Required for HA. Not required for the Enterprise version.")
	nonInteractiveFlag = flag.Bool("non-interactive", false, "Never prompt; use flag values and defaults. Fails if a required value is missing.")

	installDirFlag = flag.String("install-dir", "", "Installation directory (default /opt/pangolin)")
	containerTypeFlag = flag.String("container-type", "docker", "Container runtime: docker or podman")
	startContainersFlag = flag.Bool("start-containers", true, "Install and start the containers after generating the configuration")

	enterpriseFlag = flag.Bool("enterprise", false, "Install the Enterprise Edition")
	postgresFlag = flag.Bool("postgres", false, "Use PostgreSQL instead of SQLite")
	postgresPasswordFlag = flag.String("postgres-password", "", "Password for the PostgreSQL pangolin user")
	redisPasswordFlag = flag.String("redis-password", "", "Password for the Redis service (requires --redis)")
	baseDomainFlag = flag.String("base-domain", "", "Base domain without subdomain (e.g. example.com)")
	dashboardDomainFlag = flag.String("dashboard-domain", "", "Domain for the Pangolin dashboard (default pangolin.<base-domain>)")
	letsEncryptEmailFlag = flag.String("letsencrypt-email", "", "Email for Let's Encrypt certificates")
	gerbilFlag = flag.Bool("gerbil", true, "Install Gerbil to allow tunneled connections")
	ipv6Flag = flag.Bool("ipv6", true, "Enable IPv6 on the Docker network")
	maxmindFlag = flag.Bool("maxmind", true, "Download the MaxMind GeoLite2 Country and ASN databases")

	emailFlag = flag.Bool("email", false, "Enable email functionality (SMTP)")
	smtpHostFlag = flag.String("smtp-host", "", "SMTP host")
	smtpPortFlag = flag.Int("smtp-port", 587, "SMTP port")
	smtpUserFlag = flag.String("smtp-user", "", "SMTP username")
	smtpPassFlag = flag.String("smtp-pass", "", "SMTP password")
	smtpNoReplyFlag = flag.String("smtp-no-reply", "", "No-reply email address")

	flag.Parse()

	flag.Visit(func(f *flag.Flag) {
		setFlags[f.Name] = true
	})
}

func isNonInteractive() bool {
	return nonInteractiveFlag != nil && *nonInteractiveFlag
}

// boolAnswer returns the flag value if it was set, otherwise prompts.
func boolAnswer(name string, value bool, prompt string, defaultValue bool) bool {
	if setFlags[name] {
		return value
	}
	return readBool(prompt, defaultValue)
}

// stringAnswer returns the flag value if it was set, otherwise prompts.
func stringAnswer(name string, value string, prompt string, defaultValue string) string {
	if setFlags[name] && value != "" {
		return value
	}
	if isNonInteractive() && defaultValue == "" {
		fmt.Printf("Error: --%s is required in non-interactive mode\n", name)
		os.Exit(1)
	}
	return readString(prompt, defaultValue)
}

// passwordAnswer returns the flag value if it was set, otherwise prompts.
func passwordAnswer(name string, value string, prompt string) string {
	if setFlags[name] && value != "" {
		return value
	}
	if isNonInteractive() {
		fmt.Printf("Error: --%s is required in non-interactive mode\n", name)
		os.Exit(1)
	}
	return readPassword(prompt)
}

// intAnswer returns the flag value if it was set, otherwise prompts.
func intAnswer(name string, value int, prompt string, defaultValue int) int {
	if setFlags[name] {
		return value
	}
	return readInt(prompt, defaultValue)
}
