{ pkgs ? import <nixpkgs> {}
, lib ? pkgs.lib
, source ? import ../source.nix { inherit pkgs; }
}:

with pkgs;

stdenv.mkDerivation rec {
  pname = "hoardy-web-extension";
  version = "1.15.1";

  inherit (source) src unpackPhase;
  sourceRoot = "${src.name}/extension";

  nativeBuildInputs = [ git jq pandoc zip imagemagick vim.xxd ];

  buildPhase = ''
    ./build.sh clean firefox chromium-mv2
  '';

  installPhase = ''
    mkdir -p $out
    git archive --format tar.gz -o $out/Hoardy-Web-source-v${version}.tar.gz extension-v${version}
    cd dist
    cp -at $out *.xpi *.zip *.crx
  '';
}
