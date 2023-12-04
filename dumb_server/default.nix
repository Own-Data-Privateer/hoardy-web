{ pkgs ? import <nixpkgs> {}
, lib ? pkgs.lib
, source ? import ../source.nix { inherit pkgs; }
}:

with pkgs;

python3Packages.buildPythonApplication rec {
  pname = "pwebarc-dumb-dump-server";
  version = "1.5.5";
  format = "pyproject";

  inherit (source) src unpackPhase;
  sourceRoot = "${src.name}/dumb_server";

  propagatedBuildInputs = with python3Packages; [
    setuptools
    cbor2
  ];
}
