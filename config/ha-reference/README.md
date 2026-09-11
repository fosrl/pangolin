you need 3 instances at a minimum: node1 running pangolin, node 2 running pangolin, and a database server running postgres and redis. the third instance does not need to be a instance - you could deploy pg and redis however you want as long as its accessable to the nodes. the redis that is deployed needs to support pub sub.

the two pangolin nodes need to have public STATIC ips accessible on the internet <NODE1_EXTERNAL_IP> AND <NODE2_EXTERNAL_IP>
the two nodes need tp be able to address each other <NODE1_INTERNAL_IP> and <NODE2_INTERNAL_IP>

update these values in the `docker-compose.yml` file under the gerbil section:

```yaml
  gerbil:
    image: docker.io/fosrl/gerbil:latest
    container_name: gerbil
    restart: unless-stopped
    depends_on:
      pangolin:
        condition: service_healthy
    command:
      - --reachableAt=http://<NODE1_INTERNAL_IP>:3004
      - --generateAndSaveKeyTo=/var/config/key
      - --remoteConfig=http://pangolin:3001/api/v1/
      - --trusted-upstreams=<NODE1_EXTERNAL_IP>,<NODE2_EXTERNAL_IP> # All trusted nodes in the cluster
```

open ports should look like this

**Outbound Rules**

| Name | IP version | Type | Protocol | Port range | Destination | Description |
| --- | --- | --- | --- | --- | --- | --- |
| – | IPv4 | All traffic | All | All | 0.0.0.0/0 | Allow all outbound |

**Inbound Rules**

| Name | IP version | Type | Protocol | Port range | Source | Description |
| --- | --- | --- | --- | --- | --- | --- |
| – | IPv4 | Custom UDP | UDP | 21820 | 0.0.0.0/0 | WireGuard Relay Port |
| – | IPv4 | DNS (UDP) | UDP | 53 | 0.0.0.0/0 | DNS |
| – | IPv4 | HTTP | TCP | 80 | 0.0.0.0/0 | Ping and redirects |
| – | IPv4 | Custom UDP | UDP | 51820 | 0.0.0.0/0 | WireGuard Port |
| – | IPv4 | Custom TCP | TCP | 3004 | <self - all other nodes> | Pangolin API |
| – | IPv4 | HTTPS | TCP | 443 | 0.0.0.0/0 | Resources inbound |



add your email address for acme into <CONTACT_EMAIL>

only one of the nodes - in this case node1 - should be configured to run the acme client. the other node should have acme disabled. this is because only one node should be responsible for generating and renewing certificates. the other node will use the same certificates from the database. this is controlled with `acme.enable_acme_client`

delegating domains:

you need to create a namesever dns record. this is an a record pointing at the cluster for the DNS nameserver. 

in the example config, this is ns.example.com. you can replace example.com with your domain or choose a any subdomain. Create an A record pointing at your cluster's load ballencer:

| Name | Type | Value |
| --- | --- | --- |
| ns.example.com | A | <LOAD_BALANCER_IP> |

if you plan to support cname delegation to the server you will need to add an additional cname record for the cluster. this is an example of a cname record pointing at the cluster for the DNS nameserver.

| Name | Type | Value |
| --- | --- | --- |
| cname.example.com | NS | ns.example.com |

finally, if you would like to support site-to-cloud networking, you can delegate a domain to be able to resolve site addresses withing a cloud encironement to address them through remote nodes. this looks like the above

| Name | Type | Value |
| --- | --- | --- |
| site.example.com | NS | ns.example.com |

update all three of these values in the privateConfig dns section: 

```yaml
dns:
  enabled: true
  nameserver_name: "ns.example.com"
  cname_extension: "cname.example.com"
  site_extension: "site.example.com" # Optional
```

--

when  you start for the first time pick one node to start first. This node will init the database and print out the init token to the logs. Use this token to visit the UI and login to create the first user. Then bring up the other nodes


notes:

traefik uses file_mode: true. this is different than the  regular pangolin instrall which scrapes the http api.  the file mode writes the traefik config into the dynamic directory - the routers and certs. This is because traefik will only pull cert config files from a file and not from an api. ensure there is a shared volume beteeen pangolin and traefik 

be sure to download and keep up to date the maxmind databases for geoip and asn. these are used for geolocation and asn lookups. (reference the geoblocking docs here) and place them into the config directory GeoLite2-ASN.mmdb and GeoLite2-Country.mmdb 

--

whats required: 

a load balancer in front of the nodes. this can be a cloud load balancer or a self hosted one like traefik. the load balancer should be configured to route traffic to both nodes pangolin UI and . the load balancer should also have a health check configured to check the /ping endpoint on both nodes. if a node is unhealthy, the load balancer should stop routing traffic to that node.


todo: we should put the dynamic config back on both nodes so that all the upstream LB has to do is route to one entrypoint and we deal with the pangolin routing downstream like the websocket and api and stuff


troubleshooting:

if you run into loopback issues with the local pangolin instance not being able to address the local gerbil at the IP of the host programmed in reachble at in the docker compose file then you can set the following in the private config file. this will force it to address the docker container instead.

```
gerbil: 
    local_exit_node_reachable_at: "http://gerbil:3004"
```
