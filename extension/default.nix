{ pkgs ? import <nixpkgs> {}
, lib ? pkgs.lib
, source ? import ../source.nix { inherit pkgs; }
}:

with pkgs;

stdenv.mkDerivation rec {
  pname = "pwebarc-extension";
  version = "1.9.0";

  inherit (source) src unpackPhase;
  sourceRoot = "${src.name}/extension";

  nativeBuildInputs = [ git jq pandoc zip imagemagick vim.xxd ];

  buildPhase = ''
    ./build.sh clean firefox chromium
  '';

  installPhase = ''
    mkdir -p $out
    git archive --format tar.gz -o $out/pWebArc-source-v${version}.tar.gz extension-v${version}
    cd dist
    cp -at $out *.xpi *.zip *.crx
  '';
}
