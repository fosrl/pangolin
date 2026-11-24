package main

import (
	"os"
	"path/filepath"
	"testing"

	"gopkg.in/yaml.v3"
)

// Adding CrowdSec to an existing install merges the CrowdSec traefik config
// into the user's traefik_config.yml. That must not touch the user's ACME
// resolver settings, e.g. re-add httpChallenge after switching to dnsChallenge.
func TestCrowdsecMergeKeepsACMEResolver(t *testing.T) {
	dir := t.TempDir()
	base := filepath.Join(dir, "traefik_config.yml")
	overlay := filepath.Join(dir, "crowdsec_traefik_config.yml")

	userConfig := `certificatesResolvers:
  letsencrypt:
    acme:
      dnsChallenge:
        provider: cloudflare
      email: "admin@example.com"
      storage: "/letsencrypt/acme.json"
      caServer: "https://acme-staging-v02.api.letsencrypt.org/directory"
`
	if err := os.WriteFile(base, []byte(userConfig), 0644); err != nil {
		t.Fatal(err)
	}

	crowdsecConfig, err := configFiles.ReadFile("config/crowdsec/traefik_config.yml")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(overlay, crowdsecConfig, 0644); err != nil {
		t.Fatal(err)
	}

	if err := MergeYAML(base, overlay); err != nil {
		t.Fatal(err)
	}

	merged, err := os.ReadFile(base)
	if err != nil {
		t.Fatal(err)
	}
	var cfg struct {
		CertificatesResolvers struct {
			Letsencrypt struct {
				Acme map[string]any `yaml:"acme"`
			} `yaml:"letsencrypt"`
		} `yaml:"certificatesResolvers"`
		Experimental struct {
			Plugins map[string]any `yaml:"plugins"`
		} `yaml:"experimental"`
	}
	if err := yaml.Unmarshal(merged, &cfg); err != nil {
		t.Fatal(err)
	}

	acme := cfg.CertificatesResolvers.Letsencrypt.Acme
	if _, ok := acme["httpChallenge"]; ok {
		t.Errorf("httpChallenge was added back to the resolver: %v", acme)
	}
	if _, ok := acme["dnsChallenge"]; !ok {
		t.Errorf("dnsChallenge was removed from the resolver: %v", acme)
	}
	if got := acme["caServer"]; got != "https://acme-staging-v02.api.letsencrypt.org/directory" {
		t.Errorf("caServer was overwritten: %v", got)
	}
	if got := acme["email"]; got != "admin@example.com" {
		t.Errorf("email was overwritten: %v", got)
	}
	if _, ok := cfg.Experimental.Plugins["crowdsec"]; !ok {
		t.Errorf("crowdsec plugin was not merged in")
	}
}
