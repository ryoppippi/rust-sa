.PHONY: dev
dev:
	portless sa pnpm dev

.PHONY: codegen
codegen:
	pnpm exec graphql-codegen --config codegen.ts

.PHONY: codegen-watch
codegen-watch:
	pnpm exec graphql-codegen --config codegen.ts --watch

.PHONY: build
build:
	pnpm build
	cp .output/public/_shell.html .output/public/index.html

.PHONY: lint
lint:
	pnpm exec tsc --noEmit
	pnpm exec oxlint
	pnpm exec oxfmt --check
	pnpm exec knip

.PHONY: fmt
fmt:
	pnpm exec oxfmt --write

.PHONY: clean
clean:
	rm -rf dist .tanstack .output src/graphql/generated
