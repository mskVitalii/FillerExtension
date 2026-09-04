EXT_DIR := extension
DIST_DIR := $(EXT_DIR)/dist
ZIP_FILE := extension.zip
PKG_JSON := $(EXT_DIR)/package.json
MANIFEST_JSON := $(EXT_DIR)/manifest.json

.DEFAULT_GOAL := help

.PHONY: help install dev build typecheck lint lint-fix test clean zip package \
        version version-patch version-minor version-major release rebuild

help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Install extension dependencies
	cd $(EXT_DIR) && npm install

dev: ## Start Vite dev server (watch build into extension/dist)
	cd $(EXT_DIR) && npm run dev

build: ## Typecheck + production build into extension/dist
	cd $(EXT_DIR) && npm run build

typecheck: ## Run TypeScript type checking only
	cd $(EXT_DIR) && npm run typecheck

lint: ## Run ESLint
	cd $(EXT_DIR) && npm run lint

lint-fix: ## Run ESLint with --fix
	cd $(EXT_DIR) && npm run lint -- --fix

test: ## Run the autofill-engine regression suite (Vitest, jsdom — no browser/extension load needed)
	cd $(EXT_DIR) && npm test

clean: ## Remove build output and packaged zip
	rm -rf $(DIST_DIR) $(ZIP_FILE)

zip: build ## Build and package extension/dist into extension.zip (root)
	rm -f $(ZIP_FILE)
	cd $(DIST_DIR) && zip -r -X ../../$(ZIP_FILE) . -x '.DS_Store' -x '**/.DS_Store'
	@echo "Packaged $(ZIP_FILE) ($$(du -h $(ZIP_FILE) | cut -f1))"

package: zip ## Alias for zip

rebuild: clean build ## Clean and rebuild from scratch

version: ## Print current extension version
	@node -p "require('./$(PKG_JSON)').version"

version-patch: ## Bump patch version (0.2.0 -> 0.2.1) in package.json + manifest.json
	@$(MAKE) _bump-version PART=patch

version-minor: ## Bump minor version (0.2.0 -> 0.3.0) in package.json + manifest.json
	@$(MAKE) _bump-version PART=minor

version-major: ## Bump major version (0.2.0 -> 1.0.0) in package.json + manifest.json
	@$(MAKE) _bump-version PART=major

.PHONY: _bump-version
_bump-version:
	@cd $(EXT_DIR) && npm version $(PART) --no-git-tag-version --allow-same-version >/dev/null
	@node -e "\
		const fs = require('fs'); \
		const pkgPath = '$(PKG_JSON)'; \
		const manifestPath = '$(MANIFEST_JSON)'; \
		const version = require('./' + pkgPath).version; \
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); \
		manifest.version = version; \
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n'); \
		console.log('Version bumped to ' + version); \
	"

release: clean install build zip ## Full clean release: install, build, package into extension.zip
	@echo "Release ready: $(ZIP_FILE)"
