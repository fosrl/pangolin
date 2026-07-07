<div align="center">
    <h2>
    <a href="https://pangolin.net/">
        <picture>
            <source media="(prefers-color-scheme: dark)" srcset="public/logo/word_mark_white.png">
            <img alt="Pangolin Logo" src="public/logo/word_mark_black.png" width="350">
        </picture>
    </a>
    </h2>
</div>

<div align="center">
  <h5>
      <a href="https://pangolin.net/">
        Website
      </a>
      <span> | </span>
      <a href="https://docs.pangolin.net/">
        Documentation
      </a>
      <span> | </span>
      <a href="mailto:contact@pangolin.net">
        Contact Us
      </a>
  </h5>
</div>

<div align="center">

[![Discord](https://img.shields.io/discord/1325658630518865980?logo=discord&style=flat-square)](https://discord.gg/HCJR8Xhme4)
[![Slack](https://img.shields.io/badge/chat-slack-yellow?style=flat-square&logo=slack)](https://pangolin.net/slack)
[![Docker](https://img.shields.io/docker/pulls/fosrl/pangolin?style=flat-square)](https://hub.docker.com/r/fosrl/pangolin)
![Stars](https://img.shields.io/github/stars/fosrl/pangolin?style=flat-square)
[![YouTube](https://img.shields.io/badge/YouTube-red?logo=youtube&logoColor=white&style=flat-square)](https://www.youtube.com/@pangolin-net)

</div>

<p align="center">
    <strong>
        Get started with Pangolin at <a href="https://app.pangolin.net/auth/signup">app.pangolin.net</a>
    </strong>
</p>

Pangolin is an open-source, identity-based remote access platform built on WireGuard® that enables secure, seamless connectivity to private and public resources. Pangolin combines reverse proxy and VPN capabilities into one platform, providing browser-based access to web applications and client-based access to any private resources with NAT traversal, all with granular access controls.

## Installation

- Get started for free with [Pangolin Cloud](https://app.pangolin.net/).
- Or, check out the [quick install guide](https://docs.pangolin.net/self-host/quick-install) for how to self-host Pangolin.
  - Install from the [DigitalOcean marketplace](https://marketplace.digitalocean.com/apps/pangolin-ce-1?refcode=edf0480eeb81) for a one-click pre-configured installer.

<img src="public/screenshots/hero.png" alt="Pangolin" width="100%" />

## Deployment Options

- **Pangolin Cloud** - Fully managed service - no infrastructure required.
- **Self-Host: Community Edition** - Free, open source, and licensed under AGPL-3.
- **Self-Host: Enterprise Edition** - Licensed under Fossorial Commercial License. Free for personal and hobbyist use, and for businesses making less than \$100K USD gross annual revenue.

## Key Features

### Connect remote networks with sites and NAT traversal

Pangolin's site connectors provide gateways into networks so you can access any networked resources. Sites use outbound tunnels and intelligent NAT traversal to make networks behind restrictive firewalls available for authorized access without public IPs or open ports. Easily deploy a site as a binary or container on any platform.

<img src="public/screenshots/sites.png" alt="Sites" width="100%" />

### Browser-based reverse proxy access

Expose web applications through identity and context-aware tunneled reverse proxies. Users access applications through any web browser with authentication and granular access control without installing a client. Pangolin handles routing, load balancing, health checking, and automatic SSL certificates without exposing your network directly to the internet.

<img src="public/clip.gif" alt="Reverse proxy access" width="100%" />

### Client-based private resource access

Access private resources like SSH servers, databases, RDP, and entire network ranges through Pangolin clients. Intelligent NAT traversal enables connections even through restrictive firewalls, while DNS aliases provide friendly names and fast connections to resources across all your sites. Add redundancy by routing traffic through multiple connectors in your network.

<img src="public/screenshots/private-resources.png" alt="Private resources" width="100%" />

### Give users and roles access to resources

Use Pangolin's built in users or bring your own identity provider and set up role based access control (RBAC). Grant users access to specific resources, not entire networks. Unlike traditional VPNs that expose full network access, Pangolin's zero-trust model ensures users can only reach the applications, services, and routes you explicitly define.

<img src="public/screenshots/users.png" alt="Users from identity provider with roles" width="100%" />

## Download Clients

Download the Pangolin client for your platform:

- [Mac](https://pangolin.net/downloads/mac)
- [Windows](https://pangolin.net/downloads/windows)
- [Linux](https://pangolin.net/downloads/linux)
- [iOS](https://pangolin.net/downloads/ios)
- [Android](https://pangolin.net/downloads/android)

## Get Started

### Sign up now

Create a free account at [app.pangolin.net](https://app.pangolin.net) to get started with Pangolin Cloud.

### Check out the docs

We encourage everyone to read the full documentation first, which is
available at [docs.pangolin.net](https://docs.pangolin.net). This README provides only a very brief subset of
the docs to illustrate some basic ideas.

## Licensing

Pangolin is dual licensed under the AGPL-3 and the [Fossorial Commercial License](https://pangolin.net/fcl). For inquiries about commercial licensing, please contact us at [contact@pangolin.net](mailto:contact@pangolin.net).

## Contributions

Please see [CONTRIBUTING](./CONTRIBUTING.md) in the repository for guidelines and best practices.
