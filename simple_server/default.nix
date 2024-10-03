{ pkgs ? import <nixpkgs> {}
, lib ? pkgs.lib
, source ? import ../source.nix { inherit pkgs; }
}:

with pkgs;

python3Packages.buildPythonApplication rec {
  pname = "hoardy-web-sas";
  version = "1.7.0";
  format = "pyproject";

  inherit (source) src unpackPhase;
  sourceRoot = "${src.name}/simple_server";

  propagatedBuildInputs = with python3Packages; [
    setuptools
    cbor2
  ];
}
