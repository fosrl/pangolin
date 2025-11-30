all: update-versions go-build-release put-back
dev-all: dev-update-versions dev-build dev-clean

go-build-release:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bin/installer_linux_amd64
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o bin/installer_linux_arm64

clean:
	rm -f bin/installer_linux_amd64
	rm -f bin/installer_linux_arm64

update-versions:
	@echo "Fetching latest versions..."
	cp main.go main.go.bak && \
	$(MAKE) dev-update-versions

put-back:
	mv main.go.bak main.go

dev-update-versions:
	if [ -z "$(tag)" ]; then \
		PANGOLIN_VERSION=$$(curl -s https://api.github.com/repos/fosrl/pangolin/tags | jq -r '.[0].name'); \
	else \
		PANGOLIN_VERSION=$(tag); \
	fi && \
	GERBIL_VERSION=$$(curl -s https://api.github.com/repos/fosrl/gerbil/tags | jq -r '.[0].name') && \
	BADGER_VERSION=$$(curl -s https://api.github.com/repos/fosrl/badger/tags | jq -r '.[0].name') && \
	echo "Latest versions - Pangolin: $$PANGOLIN_VERSION, Gerbil: $$GERBIL_VERSION, Badger: $$BADGER_VERSION" && \
	sed -i "s/config.PangolinVersion = \".*\"/config.PangolinVersion = \"$$PANGOLIN_VERSION\"/" main.go && \
	sed -i "s/config.GerbilVersion = \".*\"/config.GerbilVersion = \"$$GERBIL_VERSION\"/" main.go && \
	sed -i "s/config.BadgerVersion = \".*\"/config.BadgerVersion = \"$$BADGER_VERSION\"/" main.go && \
	echo "Updated main.go with latest versions"

dev-build: go-build-release

dev-clean:
	@echo "Restoring version values ..."
	sed -i "s/config.PangolinVersion = \".*\"/config.PangolinVersion = \"replaceme\"/" main.go && \
	sed -i "s/config.GerbilVersion = \".*\"/config.GerbilVersion = \"replaceme\"/" main.go && \
	sed -i "s/config.BadgerVersion = \".*\"/config.BadgerVersion = \"replaceme\"/" main.go
	@echo "Restored version strings in main.go"
