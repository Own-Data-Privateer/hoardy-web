{ pkgs ? import <nixpkgs> {}
, debug ? false
}:

let packages = import ./packages.nix { inherit pkgs debug; }; in

pkgs.buildEnv {
  name = "hoardy-web-env-20241109";
  paths = with packages; [
    simple_server
    extension
    tool
  ];
}
