{
  description = "A Nix-flake-based C/C++ development environment";
  nixConfig.bash-prompt-suffix = "(Scraper) ";

  #inputs.nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" ];
      forEachSupportedSystem = f: nixpkgs.lib.genAttrs supportedSystems (system: f {
        pkgs = import nixpkgs { inherit system; config.allowUnfree = true; };
      });
    in
    {
      devShells = forEachSupportedSystem ({ pkgs }:
        let
          runtimePackages = with pkgs; [
                # packages are required for Puppeteer to load GUI libraries for Chromium.
                glib
                expat
                nss
                nspr
                cups
                dbus
                libdrm
                alsa-lib  # libasound
                gtk3
                mesa
                pango
                cairo
                at-spi2-atk  # libatk-1.0 / libatk-bridge-2.0
                gdk-pixbuf
                xorg.libXScrnSaver # libXss
                xorg.libX11
                xorg.libXcomposite
                xorg.libXcursor
                xorg.libXdamage
                xorg.libXext
                xorg.libXfixes
                xorg.libXi
              xorg.libXrandr
                xorg.libXrender
                xorg.libXtst
                xorg.libxcb
              ];
        in
      {

        default = pkgs.mkShell.override
          {
            # Override stdenv in order to change compiler:
            # stdenv = pkgs.clangStdenv;
          }
          {

            packages = runtimePackages;

            env = with pkgs; {
              # Puppeteer loads GUI libraries at runtime for Chrome.
              LD_LIBRARY_PATH = "${lib.makeLibraryPath runtimePackages}";
            };
          };
      });
    };
}