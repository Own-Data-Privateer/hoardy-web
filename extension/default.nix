{
  pkgs ? import <nixpkgs> { },
  lib ? pkgs.lib,
  source ? import ../source.nix { inherit pkgs; },
  developer ? false,
  minimal ? false,
}:

with pkgs;

stdenv.mkDerivation rec {
  pname = "hoardy-web-extension";
  version = builtins.readFile ./VERSION;

  inherit (source) src unpackPhase;
  sourceRoot = "${src.name}/extension";

  nativeBuildInputs = [
    git
    jq
    pandoc
    zip
    imagemagick
    vim.xxd
  ] ++ lib.optionals developer [
    oxfmt
    oxlint
  ] ++ lib.optionals (developer && !minimal) [
    prettier
    prettier-plugin-curly
    biome
  ];

  shellHook = lib.optionalString (developer && !minimal) ''
    export PRETTIER_CURLY=${prettier-plugin-curly}/lib/node_modules/prettier-plugin-curly/lib/index.cjs
  '';

  buildPhase = ''
    runHook shellHook

    ./sanity.sh --check
    ./build.sh clean firefox-mv2 chromium-mv2
  '';

  installPhase = ''
    mkdir -p $out
    git archive --format tar.gz -o $out/Hoardy-Web-source-v${version}.tar.gz extension-v${version}
    cd dist
    cp -at $out *.xpi *.zip *.crx
  '';
}
