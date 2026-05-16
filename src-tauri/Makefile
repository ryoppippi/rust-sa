.PHONY: dev
dev:
	cargo run --bin serve

.PHONY: dev-tauri
dev-tauri:
	cargo tauri dev

.PHONY: build
build:
	cargo tauri build

.PHONY: check
check:
	cargo check
	cargo clippy -- -D warnings

.PHONY: fmt
fmt:
	cargo fmt

.PHONY: clean
clean:
	cargo clean
	rm -rf ../dist
