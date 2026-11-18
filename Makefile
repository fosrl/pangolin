.PHONY: build build-pg build-release build-release-arm build-release-amd create-manifests build-arm build-x86 test clean

major_tag := $(shell echo $(tag) | cut -d. -f1)
minor_tag := $(shell echo $(tag) | cut -d. -f1,2)

# OCI label variables
CREATED := $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
REVISION := $(shell git rev-parse HEAD 2>/dev/null || echo "unknown")

# Common OCI build args for OSS builds
OCI_ARGS_OSS = --build-arg VERSION=$(tag) \
	--build-arg REVISION=$(REVISION) \
	--build-arg CREATED=$(CREATED) \
	--build-arg IMAGE_TITLE="Pangolin" \
	--build-arg IMAGE_DESCRIPTION="Identity-aware VPN and proxy for remote access to anything, anywhere"

# Common OCI build args for Enterprise builds
OCI_ARGS_EE = --build-arg VERSION=$(tag) \
	--build-arg REVISION=$(REVISION) \
	--build-arg CREATED=$(CREATED) \
	--build-arg LICENSE="Fossorial Commercial" \
	--build-arg IMAGE_TITLE="Pangolin EE" \
	--build-arg IMAGE_DESCRIPTION="Pangolin Enterprise Edition - Identity-aware VPN and proxy for remote access to anything, anywhere"

.PHONY: build-release build-sqlite build-postgresql build-ee-sqlite build-ee-postgresql

build-release: build-sqlite build-postgresql build-ee-sqlite build-ee-postgresql

build-sqlite:
	@if [ -z "$(tag)" ]; then \
		echo "Error: tag is required. Usage: make build-release tag=<tag>"; \
		exit 1; \
	fi
	docker buildx build \
		--build-arg BUILD=oss \
		--build-arg DATABASE=sqlite \
		$(OCI_ARGS_OSS) \
		--platform linux/arm64,linux/amd64 \
		--tag fosrl/pangolin:latest \
		--tag fosrl/pangolin:$(major_tag) \
		--tag fosrl/pangolin:$(minor_tag) \
		--tag fosrl/pangolin:$(tag) \
		--push .

build-postgresql:
	@if [ -z "$(tag)" ]; then \
		echo "Error: tag is required. Usage: make build-release tag=<tag>"; \
		exit 1; \
	fi
	docker buildx build \
		--build-arg BUILD=oss \
		--build-arg DATABASE=pg \
		$(OCI_ARGS_OSS) \
		--platform linux/arm64,linux/amd64 \
		--tag fosrl/pangolin:postgresql-latest \
		--tag fosrl/pangolin:postgresql-$(major_tag) \
		--tag fosrl/pangolin:postgresql-$(minor_tag) \
		--tag fosrl/pangolin:postgresql-$(tag) \
		--push .

build-ee-sqlite:
	@if [ -z "$(tag)" ]; then \
		echo "Error: tag is required. Usage: make build-release tag=<tag>"; \
		exit 1; \
	fi
	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=sqlite \
		$(OCI_ARGS_EE) \
		--platform linux/arm64,linux/amd64 \
		--tag fosrl/pangolin:ee-latest \
		--tag fosrl/pangolin:ee-$(major_tag) \
		--tag fosrl/pangolin:ee-$(minor_tag) \
		--tag fosrl/pangolin:ee-$(tag) \
		--push .

build-ee-postgresql:
	@if [ -z "$(tag)" ]; then \
		echo "Error: tag is required. Usage: make build-release tag=<tag>"; \
		exit 1; \
	fi
	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=pg \
		$(OCI_ARGS_EE) \
		--platform linux/arm64,linux/amd64 \
		--tag fosrl/pangolin:ee-postgresql-latest \
		--tag fosrl/pangolin:ee-postgresql-$(major_tag) \
		--tag fosrl/pangolin:ee-postgresql-$(minor_tag) \
		--tag fosrl/pangolin:ee-postgresql-$(tag) \
		--push .

build-saas:
	@if [ -z "$(tag)" ]; then \
		echo "Error: tag is required. Usage: make build-release tag=<tag>"; \
		exit 1; \
	fi
	docker buildx build \
		--build-arg BUILD=saas \
		--build-arg DATABASE=pg \
		--platform linux/arm64 \
		--tag $(AWS_IMAGE):$(tag) \
		--push .
	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=pg \
		--platform linux/arm64 \
		--tag $(AWS_IMAGE):$(tag)-ee \
		--push .

	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=pg \
		--platform linux/arm64 \
		--tag $(AWS_IMAGE):$(tag)-ee \
		--push .

build-release-arm:
	@if [ -z "$(tag)" ]; then \
		echo "Error: tag is required. Usage: make build-release-arm tag=<tag>"; \
		exit 1; \
	fi
	@MAJOR_TAG=$$(echo $(tag) | cut -d. -f1); \
	MINOR_TAG=$$(echo $(tag) | cut -d. -f1,2); \
	CREATED=$$(date -u +"%Y-%m-%dT%H:%M:%SZ"); \
	REVISION=$$(git rev-parse HEAD 2>/dev/null || echo "unknown"); \
	docker buildx build \
		--build-arg BUILD=oss \
		--build-arg DATABASE=sqlite \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg IMAGE_TITLE="Pangolin" \
		--build-arg IMAGE_DESCRIPTION="Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/arm64 \
		--tag fosrl/pangolin:latest-arm64 \
		--tag fosrl/pangolin:$$MAJOR_TAG-arm64 \
		--tag fosrl/pangolin:$$MINOR_TAG-arm64 \
		--tag fosrl/pangolin:$(tag)-arm64 \
		--push . && \
	docker buildx build \
		--build-arg BUILD=oss \
		--build-arg DATABASE=pg \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg IMAGE_TITLE="Pangolin" \
		--build-arg IMAGE_DESCRIPTION="Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/arm64 \
		--tag fosrl/pangolin:postgresql-latest-arm64 \
		--tag fosrl/pangolin:postgresql-$$MAJOR_TAG-arm64 \
		--tag fosrl/pangolin:postgresql-$$MINOR_TAG-arm64 \
		--tag fosrl/pangolin:postgresql-$(tag)-arm64 \
		--push . && \
	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=sqlite \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg LICENSE="Fossorial Commercial" \
		--build-arg IMAGE_TITLE="Pangolin EE" \
		--build-arg IMAGE_DESCRIPTION="Pangolin Enterprise Edition - Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/arm64 \
		--tag fosrl/pangolin:ee-latest-arm64 \
		--tag fosrl/pangolin:ee-$$MAJOR_TAG-arm64 \
		--tag fosrl/pangolin:ee-$$MINOR_TAG-arm64 \
		--tag fosrl/pangolin:ee-$(tag)-arm64 \
		--push . && \
	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=pg \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg LICENSE="Fossorial Commercial" \
		--build-arg IMAGE_TITLE="Pangolin EE" \
		--build-arg IMAGE_DESCRIPTION="Pangolin Enterprise Edition - Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/arm64 \
		--tag fosrl/pangolin:ee-postgresql-latest-arm64 \
		--tag fosrl/pangolin:ee-postgresql-$$MAJOR_TAG-arm64 \
		--tag fosrl/pangolin:ee-postgresql-$$MINOR_TAG-arm64 \
		--tag fosrl/pangolin:ee-postgresql-$(tag)-arm64 \
		--push .

build-release-amd:
	@if [ -z "$(tag)" ]; then \
		echo "Error: tag is required. Usage: make build-release-amd tag=<tag>"; \
		exit 1; \
	fi
	@MAJOR_TAG=$$(echo $(tag) | cut -d. -f1); \
	MINOR_TAG=$$(echo $(tag) | cut -d. -f1,2); \
	CREATED=$$(date -u +"%Y-%m-%dT%H:%M:%SZ"); \
	REVISION=$$(git rev-parse HEAD 2>/dev/null || echo "unknown"); \
	docker buildx build \
		--build-arg BUILD=oss \
		--build-arg DATABASE=sqlite \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg IMAGE_TITLE="Pangolin" \
		--build-arg IMAGE_DESCRIPTION="Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/amd64 \
		--tag fosrl/pangolin:latest-amd64 \
		--tag fosrl/pangolin:$$MAJOR_TAG-amd64 \
		--tag fosrl/pangolin:$$MINOR_TAG-amd64 \
		--tag fosrl/pangolin:$(tag)-amd64 \
		--push . && \
	docker buildx build \
		--build-arg BUILD=oss \
		--build-arg DATABASE=pg \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg IMAGE_TITLE="Pangolin" \
		--build-arg IMAGE_DESCRIPTION="Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/amd64 \
		--tag fosrl/pangolin:postgresql-latest-amd64 \
		--tag fosrl/pangolin:postgresql-$$MAJOR_TAG-amd64 \
		--tag fosrl/pangolin:postgresql-$$MINOR_TAG-amd64 \
		--tag fosrl/pangolin:postgresql-$(tag)-amd64 \
		--push . && \
	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=sqlite \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg LICENSE="Fossorial Commercial" \
		--build-arg IMAGE_TITLE="Pangolin EE" \
		--build-arg IMAGE_DESCRIPTION="Pangolin Enterprise Edition - Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/amd64 \
		--tag fosrl/pangolin:ee-latest-amd64 \
		--tag fosrl/pangolin:ee-$$MAJOR_TAG-amd64 \
		--tag fosrl/pangolin:ee-$$MINOR_TAG-amd64 \
		--tag fosrl/pangolin:ee-$(tag)-amd64 \
		--push . && \
	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=pg \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg LICENSE="Fossorial Commercial" \
		--build-arg IMAGE_TITLE="Pangolin EE" \
		--build-arg IMAGE_DESCRIPTION="Pangolin Enterprise Edition - Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/amd64 \
		--tag fosrl/pangolin:ee-postgresql-latest-amd64 \
		--tag fosrl/pangolin:ee-postgresql-$$MAJOR_TAG-amd64 \
		--tag fosrl/pangolin:ee-postgresql-$$MINOR_TAG-amd64 \
		--tag fosrl/pangolin:ee-postgresql-$(tag)-amd64 \
		--push .

create-manifests:
	@if [ -z "$(tag)" ]; then \
		echo "Error: tag is required. Usage: make create-manifests tag=<tag>"; \
		exit 1; \
	fi
	@MAJOR_TAG=$$(echo $(tag) | cut -d. -f1); \
	MINOR_TAG=$$(echo $(tag) | cut -d. -f1,2); \
	echo "Creating multi-arch manifests for sqlite (oss)..." && \
	docker buildx imagetools create \
		--tag fosrl/pangolin:latest \
		--tag fosrl/pangolin:$$MAJOR_TAG \
		--tag fosrl/pangolin:$$MINOR_TAG \
		--tag fosrl/pangolin:$(tag) \
		fosrl/pangolin:latest-arm64 \
		fosrl/pangolin:latest-amd64 && \
	echo "Creating multi-arch manifests for postgresql (oss)..." && \
	docker buildx imagetools create \
		--tag fosrl/pangolin:postgresql-latest \
		--tag fosrl/pangolin:postgresql-$$MAJOR_TAG \
		--tag fosrl/pangolin:postgresql-$$MINOR_TAG \
		--tag fosrl/pangolin:postgresql-$(tag) \
		fosrl/pangolin:postgresql-latest-arm64 \
		fosrl/pangolin:postgresql-latest-amd64 && \
	echo "Creating multi-arch manifests for sqlite (enterprise)..." && \
	docker buildx imagetools create \
		--tag fosrl/pangolin:ee-latest \
		--tag fosrl/pangolin:ee-$$MAJOR_TAG \
		--tag fosrl/pangolin:ee-$$MINOR_TAG \
		--tag fosrl/pangolin:ee-$(tag) \
		fosrl/pangolin:ee-latest-arm64 \
		fosrl/pangolin:ee-latest-amd64 && \
	echo "Creating multi-arch manifests for postgresql (enterprise)..." && \
	docker buildx imagetools create \
		--tag fosrl/pangolin:ee-postgresql-latest \
		--tag fosrl/pangolin:ee-postgresql-$$MAJOR_TAG \
		--tag fosrl/pangolin:ee-postgresql-$$MINOR_TAG \
		--tag fosrl/pangolin:ee-postgresql-$(tag) \
		fosrl/pangolin:ee-postgresql-latest-arm64 \
		fosrl/pangolin:ee-postgresql-latest-amd64 && \
	echo "All multi-arch manifests created successfully!"

build-rc:
	@if [ -z "$(tag)" ]; then \
		echo "Error: tag is required. Usage: make build-release tag=<tag>"; \
		exit 1; \
	fi
	@CREATED=$$(date -u +"%Y-%m-%dT%H:%M:%SZ"); \
	REVISION=$$(git rev-parse HEAD 2>/dev/null || echo "unknown"); \
	docker buildx build \
		--build-arg BUILD=oss \
		--build-arg DATABASE=sqlite \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg IMAGE_TITLE="Pangolin" \
		--build-arg IMAGE_DESCRIPTION="Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/arm64,linux/amd64 \
		--tag fosrl/pangolin:$(tag) \
		--push . && \
	docker buildx build \
		--build-arg BUILD=oss \
		--build-arg DATABASE=pg \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg IMAGE_TITLE="Pangolin" \
		--build-arg IMAGE_DESCRIPTION="Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/arm64,linux/amd64 \
		--tag fosrl/pangolin:postgresql-$(tag) \
		--push . && \
	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=sqlite \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg LICENSE="Fossorial Commercial" \
		--build-arg IMAGE_TITLE="Pangolin EE" \
		--build-arg IMAGE_DESCRIPTION="Pangolin Enterprise Edition - Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/arm64,linux/amd64 \
		--tag fosrl/pangolin:ee-$(tag) \
		--push . && \
	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=pg \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg LICENSE="Fossorial Commercial" \
		--build-arg IMAGE_TITLE="Pangolin EE" \
		--build-arg IMAGE_DESCRIPTION="Pangolin Enterprise Edition - Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/arm64,linux/amd64 \
		--tag fosrl/pangolin:ee-postgresql-$(tag) \
		--push .

build-rc-arm:
	@if [ -z "$(tag)" ]; then \
		echo "Error: tag is required. Usage: make build-rc-arm tag=<tag>"; \
		exit 1; \
	fi
	@CREATED=$$(date -u +"%Y-%m-%dT%H:%M:%SZ"); \
	REVISION=$$(git rev-parse HEAD 2>/dev/null || echo "unknown"); \
	docker buildx build \
		--build-arg BUILD=oss \
		--build-arg DATABASE=sqlite \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg IMAGE_TITLE="Pangolin" \
		--build-arg IMAGE_DESCRIPTION="Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/arm64 \
		--tag fosrl/pangolin:$(tag)-arm64 \
		--push . && \
	docker buildx build \
		--build-arg BUILD=oss \
		--build-arg DATABASE=pg \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg IMAGE_TITLE="Pangolin" \
		--build-arg IMAGE_DESCRIPTION="Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/arm64 \
		--tag fosrl/pangolin:postgresql-$(tag)-arm64 \
		--push . && \
	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=sqlite \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg LICENSE="Fossorial Commercial" \
		--build-arg IMAGE_TITLE="Pangolin EE" \
		--build-arg IMAGE_DESCRIPTION="Pangolin Enterprise Edition - Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/arm64 \
		--tag fosrl/pangolin:ee-$(tag)-arm64 \
		--push . && \
	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=pg \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg LICENSE="Fossorial Commercial" \
		--build-arg IMAGE_TITLE="Pangolin EE" \
		--build-arg IMAGE_DESCRIPTION="Pangolin Enterprise Edition - Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/arm64 \
		--tag fosrl/pangolin:ee-postgresql-$(tag)-arm64 \
		--push .

build-rc-amd:
	@if [ -z "$(tag)" ]; then \
		echo "Error: tag is required. Usage: make build-rc-amd tag=<tag>"; \
		exit 1; \
	fi
	@CREATED=$$(date -u +"%Y-%m-%dT%H:%M:%SZ"); \
	REVISION=$$(git rev-parse HEAD 2>/dev/null || echo "unknown"); \
	docker buildx build \
		--build-arg BUILD=oss \
		--build-arg DATABASE=sqlite \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg IMAGE_TITLE="Pangolin" \
		--build-arg IMAGE_DESCRIPTION="Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/amd64 \
		--tag fosrl/pangolin:$(tag)-amd64 \
		--push . && \
	docker buildx build \
		--build-arg BUILD=oss \
		--build-arg DATABASE=pg \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg IMAGE_TITLE="Pangolin" \
		--build-arg IMAGE_DESCRIPTION="Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/amd64 \
		--tag fosrl/pangolin:postgresql-$(tag)-amd64 \
		--push . && \
	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=sqlite \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg LICENSE="Fossorial Commercial" \
		--build-arg IMAGE_TITLE="Pangolin EE" \
		--build-arg IMAGE_DESCRIPTION="Pangolin Enterprise Edition - Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/amd64 \
		--tag fosrl/pangolin:ee-$(tag)-amd64 \
		--push . && \
	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=pg \
		--build-arg VERSION=$(tag) \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg LICENSE="Fossorial Commercial" \
		--build-arg IMAGE_TITLE="Pangolin EE" \
		--build-arg IMAGE_DESCRIPTION="Pangolin Enterprise Edition - Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/amd64 \
		--tag fosrl/pangolin:ee-postgresql-$(tag)-amd64 \
		--push .

create-manifests-rc:
	@if [ -z "$(tag)" ]; then \
		echo "Error: tag is required. Usage: make create-manifests-rc tag=<tag>"; \
		exit 1; \
	fi
	@echo "Creating multi-arch manifests for RC sqlite (oss)..." && \
	docker buildx imagetools create \
		--tag fosrl/pangolin:$(tag) \
		fosrl/pangolin:$(tag)-arm64 \
		fosrl/pangolin:$(tag)-amd64 && \
	echo "Creating multi-arch manifests for RC postgresql (oss)..." && \
	docker buildx imagetools create \
		--tag fosrl/pangolin:postgresql-$(tag) \
		fosrl/pangolin:postgresql-$(tag)-arm64 \
		fosrl/pangolin:postgresql-$(tag)-amd64 && \
	echo "Creating multi-arch manifests for RC sqlite (enterprise)..." && \
	docker buildx imagetools create \
		--tag fosrl/pangolin:ee-$(tag) \
		fosrl/pangolin:ee-$(tag)-arm64 \
		fosrl/pangolin:ee-$(tag)-amd64 && \
	echo "Creating multi-arch manifests for RC postgresql (enterprise)..." && \
	docker buildx imagetools create \
		--tag fosrl/pangolin:ee-postgresql-$(tag) \
		fosrl/pangolin:ee-postgresql-$(tag)-arm64 \
		fosrl/pangolin:ee-postgresql-$(tag)-amd64 && \
	echo "All RC multi-arch manifests created successfully!"

build-arm:
	@CREATED=$$(date -u +"%Y-%m-%dT%H:%M:%SZ"); \
	REVISION=$$(git rev-parse HEAD 2>/dev/null || echo "unknown"); \
	docker buildx build \
		--build-arg VERSION=dev \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg IMAGE_TITLE="Pangolin" \
		--build-arg IMAGE_DESCRIPTION="Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/arm64 \
		-t fosrl/pangolin:latest .

build-x86:
	@CREATED=$$(date -u +"%Y-%m-%dT%H:%M:%SZ"); \
	REVISION=$$(git rev-parse HEAD 2>/dev/null || echo "unknown"); \
	docker buildx build \
		--build-arg VERSION=dev \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg IMAGE_TITLE="Pangolin" \
		--build-arg IMAGE_DESCRIPTION="Identity-aware VPN and proxy for remote access to anything, anywhere" \
		--platform linux/amd64 \
		-t fosrl/pangolin:latest .

dev-build-sqlite:
	@CREATED=$$(date -u +"%Y-%m-%dT%H:%M:%SZ"); \
	REVISION=$$(git rev-parse HEAD 2>/dev/null || echo "unknown"); \
	docker build \
		--build-arg DATABASE=sqlite \
		--build-arg VERSION=dev \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg IMAGE_TITLE="Pangolin" \
		--build-arg IMAGE_DESCRIPTION="Identity-aware VPN and proxy for remote access to anything, anywhere" \
		-t fosrl/pangolin:latest .

dev-build-pg:
	@CREATED=$$(date -u +"%Y-%m-%dT%H:%M:%SZ"); \
	REVISION=$$(git rev-parse HEAD 2>/dev/null || echo "unknown"); \
	docker build \
		--build-arg DATABASE=pg \
		--build-arg VERSION=dev \
		--build-arg REVISION=$$REVISION \
		--build-arg CREATED=$$CREATED \
		--build-arg IMAGE_TITLE="Pangolin" \
		--build-arg IMAGE_DESCRIPTION="Identity-aware VPN and proxy for remote access to anything, anywhere" \
		-t fosrl/pangolin:postgresql-latest .

test:
	docker run -it -p 3000:3000 -p 3001:3001 -p 3002:3002 -v ./config:/app/config fosrl/pangolin:latest

clean:
	docker rmi pangolin
