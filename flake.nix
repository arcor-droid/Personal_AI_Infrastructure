{
  description = "PAI - Personal AI Infrastructure (Nix devShell)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";

  outputs = { self, nixpkgs }:
  let
    system = "x86_64-linux";
    pkgs = import nixpkgs { inherit system; };
  in {
    devShells.${system}.default = pkgs.mkShell {
      packages = with pkgs; [
        bun
        nodejs_22  # For Vite (observability dashboard)
        # Playwright/Chromium dependencies for browser skill
        chromium
        # Audio libraries (for voice system on Linux)
        mpv           # Primary audio player for platform.ts
        sox
        alsa-lib
        pulseaudio
        # Desktop notifications (for Linux)
        libnotify     # Provides notify-send
        # General utilities
        curl
        jq
        gh  # GitHub CLI for fork/PR management
      ];

      shellHook = ''
        export PAI_DIR="$HOME/.claude"
        export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"

        # Ensure PAI_DIR exists
        mkdir -p "$PAI_DIR"

        echo "PAI DevShell ready."
        echo "  Bun: $(bun --version)"
        echo "  PAI_DIR: $PAI_DIR"
        echo ""
        echo "To install PAI Bundle:"
        echo "  cd Bundles/Official && bun run install.ts"
      '';
    };
  };
}
