{
  description = "rust-sa - Local Git Diff Reviewer (Tauri + Rust + TanStack Start)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    treefmt-nix.url = "github:numtide/treefmt-nix";
    rust-overlay.url = "github:oxalica/rust-overlay";
    rust-overlay.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
      ];

      imports = [
        inputs.treefmt-nix.flakeModule
      ];

      perSystem =
        { self', system, ... }:
        let
          overlay =
            final: prev:
            let
              nodejs = prev.nodejs_24;
              pnpm = prev.pnpm_10.override { inherit nodejs; };
            in
            {
              inherit
                nodejs
                pnpm
                ;
            };

          pkgs = import inputs.nixpkgs {
            inherit system;
            overlays = [
              inputs.rust-overlay.overlays.default
              overlay
            ];
          };

          rustToolchain = pkgs.rust-bin.stable.latest.default.override {
            extensions = [
              "rust-src"
              "rust-analyzer"
              "clippy"
            ];
          };

          rustPlatform = pkgs.makeRustPlatform {
            cargo = rustToolchain;
            rustc = rustToolchain;
          };

          gstPlugins = with pkgs.gst_all_1; [
            gstreamer
            gst-plugins-base
            gst-plugins-good
            gst-plugins-bad
            gst-libav
          ];

          tauriBuildInputs =
            with pkgs;
            lib.optionals stdenv.isLinux (
              [
                webkitgtk_4_1
                gtk3
                gdk-pixbuf
                glib
                librsvg
                libayatana-appindicator
                libappindicator-gtk3
                pkg-config
                openssl
                dbus
                libsoup_3
              ]
              ++ gstPlugins
            )
            ++ lib.optionals stdenv.isDarwin [ ];

          conao3-sa = rustPlatform.buildRustPackage (finalAttrs: {
            pname = "conao3-sa";
            version = "0.1.4";

            src = pkgs.lib.cleanSource ./.;

            cargoRoot = "src-tauri";
            buildAndTestSubdir = finalAttrs.cargoRoot;
            cargoLock.lockFile = ./src-tauri/Cargo.lock;

            postPatch = ''
              substituteInPlace src-tauri/tauri.conf.json \
                --replace-fail \
                  'make -C ../frontend build && rm -rf dist && cp -r ../frontend/.output/public dist' \
                  'make -C frontend build && rm -rf src-tauri/dist && cp -r frontend/.output/public src-tauri/dist'
            '';

            pnpmRoot = "frontend";
            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs)
                pname
                version
                src
                ;
              pnpm = pkgs.pnpm;
              postPatch = "cd ${finalAttrs.pnpmRoot}";
              fetcherVersion = 3;
              hash = "sha256-f+zk+I3UWP1kbmA1p9ZW1woigdi+UBTc08UtH91eptU=";
            };

            nativeBuildInputs =
              with pkgs;
              [
                cargo-tauri.hook
                makeWrapper
                nodejs
                pnpm
                pnpmConfigHook
              ]
              ++ lib.optionals stdenv.isLinux [
                pkg-config
                wrapGAppsHook3
              ];

            buildInputs = tauriBuildInputs;

            postInstall = ''
              mkdir -p "$out/bin"
              candidate="$(find "$out" -type f -perm -111 \
                \( -path '*/Contents/MacOS/*' -o -path '*/bin/*' \) \
                ! -name '*.wrapped' \
                | head -n 1)"
              if [ -z "$candidate" ]; then
                echo "could not find installed sa executable" >&2
                exit 1
              fi
              makeWrapper "$candidate" "$out/bin/sa" \
                --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.git ]}
            '';

            passthru.pnpmDeps = finalAttrs.pnpmDeps;

            meta = {
              description = "Local git diff reviewer with a TanStack Start frontend and an axum/async-graphql backend";
              homepage = "https://github.com/conao3/rust-sa";
              license = pkgs.lib.licenses.mit;
              mainProgram = "sa";
              platforms = pkgs.lib.platforms.linux ++ pkgs.lib.platforms.darwin;
            };
          });

          branchSlug = pkgs.writeShellScript "branch-slug" ''
            set -euo pipefail -o posix
            BRANCH=$(${pkgs.git}/bin/git rev-parse --abbrev-ref HEAD)
            if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ] || [ "$BRANCH" = "develop" ]; then
              echo "main"
            else
              echo "$BRANCH" | sed 's/[^a-zA-Z0-9]/-/g' | tr '[:upper:]' '[:lower:]'
            fi
          '';
        in
        {
          packages.default = conao3-sa;
          packages.pnpmDeps = conao3-sa.passthru.pnpmDeps;

          apps.default = {
            type = "app";
            program = "${self'.packages.default}/bin/sa";
          };

          treefmt = {
            projectRootFile = "flake.nix";
            programs.rustfmt.enable = true;
            programs.prettier.enable = true;
            programs.nixfmt.enable = true;
          };

          devShells.default = pkgs.mkShell {
            packages =
              with pkgs;
              [
                rustToolchain
                cargo-watch
                nodejs
                pnpm
                cargo-tauri
                hyperfine
                tmux
              ]
              ++ tauriBuildInputs;

            shellHook = ''
              export RUST_LOG=info
              export TAURI_DEV_HOST=127.0.0.1
              export GST_PLUGIN_SYSTEM_PATH_1_0="${pkgs.lib.makeSearchPath "lib/gstreamer-1.0" gstPlugins}"
            '';
          };
        };
    };
}
