EXT_DIR := extension
DIST_DIR := $(EXT_DIR)/dist
ZIP_FILE := extension.zip
PKG_JSON := $(EXT_DIR)/package.json
MANIFEST_JSON := $(EXT_DIR)/manifest.json

.DEFAULT_GOAL := help

.PHONY: help init install dev build build-release typecheck lint lint-fix test clean zip package \
        version version-patch version-minor version-major release publish rebuild gh-release

help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

init: install ## First-time setup: install dependencies and create extension/.env.local from .env.example (never overwrites)
	@if [ -f $(EXT_DIR)/.env.local ]; then echo "$(EXT_DIR)/.env.local already exists, leaving it untouched"; \
	else cp $(EXT_DIR)/.env.example $(EXT_DIR)/.env.local && echo "Created $(EXT_DIR)/.env.local - set VITE_DEV_GOOGLE_CLIENT_ID in it"; fi

install: ## Install extension dependencies
	cd $(EXT_DIR) && npm install

dev: ## Start Vite dev server (watch build into extension/dist)
	cd $(EXT_DIR) && npm run dev

build: ## Typecheck + production build into extension/dist (honors extension/.env.local dev OAuth override)
	cd $(EXT_DIR) && npm run build

build-release: ## Typecheck + build into extension/dist, ignoring extension/.env.local (always ships manifest.json's real prod OAuth client)
	cd $(EXT_DIR) && npm run build:release

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

zip: build-release ## Build (release mode) and package extension/dist into extension.zip (root)
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

release: clean install zip ## Full clean release build: install, build (release mode), package into extension.zip
	@echo "Release ready: $(ZIP_FILE)"

publish: ## Bump version (PART=patch|minor|major, default patch), then full clean release build + zip
	@$(MAKE) _bump-version PART=$(or $(PART),patch)
	@$(MAKE) clean
	@$(MAKE) install
	@$(MAKE) zip
	@echo "Published v$$(node -p "require('./$(PKG_JSON)').version") -> $(ZIP_FILE)"

GH_REPO := mskVitalii/FillerExtension

gh-release: ## After the "Release X.Y.Z: ..." commit: push main, publish GitHub release extension-vX.Y.Z with extension.zip (idempotent; docs/updates.md)
	@set -e; \
	version=$$(node -p "require('./$(PKG_JSON)').version"); \
	tag="extension-v$$version"; \
	subject=$$(git log -1 --format=%s HEAD); \
	branch=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$branch" != "main" ]; then echo "gh-release: refusing - on '$$branch', not main"; exit 1; fi; \
	case "$$subject" in "Release $$version: "*) ;; *) echo "gh-release: refusing - HEAD is not a 'Release $$version: ...' commit (HEAD: $$subject)"; exit 1;; esac; \
	if ! git diff --quiet HEAD -- $(PKG_JSON) $(MANIFEST_JSON); then echo "gh-release: refusing - uncommitted changes in $(PKG_JSON) or $(MANIFEST_JSON)"; exit 1; fi; \
	manifest_version=$$(node -p "require('./$(MANIFEST_JSON)').version"); \
	if [ "$$manifest_version" != "$$version" ]; then echo "gh-release: refusing - manifest.json is $$manifest_version, package.json is $$version"; exit 1; fi; \
	if [ ! -f $(ZIP_FILE) ]; then echo "gh-release: refusing - $(ZIP_FILE) missing (run make publish first)"; exit 1; fi; \
	zip_version=$$(unzip -p $(ZIP_FILE) manifest.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))"); \
	if [ "$$zip_version" != "$$version" ]; then echo "gh-release: refusing - $(ZIP_FILE) is $$zip_version, not $$version (rebuild with make zip)"; exit 1; fi; \
	if ! git diff --quiet HEAD -- $(ZIP_FILE); then echo "gh-release: refusing - $(ZIP_FILE) differs from the one committed in the release commit"; exit 1; fi; \
	git push origin main; \
	if gh release view "$$tag" --repo $(GH_REPO) >/dev/null 2>&1; then echo "gh-release: $$tag already exists - skipping"; exit 0; fi; \
	summary="$${subject#Release $$version: }"; \
	notes=$$(printf '%s\n\n%s' "$$summary" "Unpacked install: download extension.zip, unzip it over the folder you loaded Filler from, then click Reload on Filler in chrome://extensions."); \
	gh release create "$$tag" $(ZIP_FILE) --repo $(GH_REPO) --target "$$(git rev-parse HEAD)" --title "Filler $$version" --notes "$$notes" --latest; \
	echo "gh-release: published $$tag"
