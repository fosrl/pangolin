.PHONY: build build-pg build-release build-arm build-x86 test clean

major_tag := $(shell echo $(tag) | cut -d. -f1)
minor_tag := $(shell echo $(tag) | cut -d. -f1,2)
build-release:
	@if [ -z "$(tag)" ]; then \
		echo "Error: tag is required. Usage: make build-release tag=<tag>"; \
		exit 1; \
	fi
	docker buildx build \
		--build-arg BUILD=oss \
		--build-arg DATABASE=sqlite \
		--platform linux/arm64,linux/amd64 \
		--tag fosrl/pangolin:latest \
		--tag fosrl/pangolin:$(major_tag) \
		--tag fosrl/pangolin:$(minor_tag) \
		--tag fosrl/pangolin:$(tag) \
		--push .
	docker buildx build \
		--build-arg BUILD=oss \
		--build-arg DATABASE=pg \
		--platform linux/arm64,linux/amd64 \
		--tag fosrl/pangolin:postgresql-latest \
		--tag fosrl/pangolin:postgresql-$(major_tag) \
		--tag fosrl/pangolin:postgresql-$(minor_tag) \
		--tag fosrl/pangolin:postgresql-$(tag) \
		--push .
	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=sqlite \
		--platform linux/arm64,linux/amd64 \
		--tag fosrl/pangolin:ee-latest \
		--tag fosrl/pangolin:ee-$(major_tag) \
		--tag fosrl/pangolin:ee-$(minor_tag) \
		--tag fosrl/pangolin:ee-$(tag) \
		--push .
	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=pg \
		--platform linux/arm64,linux/amd64 \
		--tag fosrl/pangolin:ee-postgresql-latest \
		--tag fosrl/pangolin:ee-postgresql-$(major_tag) \
		--tag fosrl/pangolin:ee-postgresql-$(minor_tag) \
		--tag fosrl/pangolin:ee-postgresql-$(tag) \
		--push .

build-rc:
	@if [ -z "$(tag)" ]; then \
		echo "Error: tag is required. Usage: make build-release tag=<tag>"; \
		exit 1; \
	fi
	docker buildx build \
		--build-arg BUILD=oss \
		--build-arg DATABASE=sqlite \
		--platform linux/arm64,linux/amd64 \
		--tag fosrl/pangolin:$(tag) \
		--push .
	docker buildx build \
		--build-arg BUILD=oss \
		--build-arg DATABASE=pg \
		--platform linux/arm64,linux/amd64 \
		--tag fosrl/pangolin:postgresql-$(tag) \
		--push .
	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=sqlite \
		--platform linux/arm64,linux/amd64 \
		--tag fosrl/pangolin:ee-$(tag) \
		--push .
	docker buildx build \
		--build-arg BUILD=enterprise \
		--build-arg DATABASE=pg \
		--platform linux/arm64,linux/amd64 \
		--tag fosrl/pangolin:ee-postgresql-$(tag) \
		--push .

build-arm:
	docker buildx build --platform linux/arm64 -t fosrl/pangolin:latest .

build-x86:
	docker buildx build --platform linux/amd64 -t fosrl/pangolin:latest .

build-sqlite:
	docker build --build-arg DATABASE=sqlite -t fosrl/pangolin:latest .

build-pg:
	docker build --build-arg DATABASE=pg -t fosrl/pangolin:postgresql-latest .

test:
	docker run -it -p 3000:3000 -p 3001:3001 -p 3002:3002 -v ./config:/app/config fosrl/pangolin:latest

clean:
	docker rmi pangolin
