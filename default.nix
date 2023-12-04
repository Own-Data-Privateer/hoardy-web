{ pkgs ? import <nixpkgs> {}
}:

let packages = import ./packages.nix { inherit pkgs; }; in

pkgs.buildEnv {
  name = "pwebarc-20231204";
  paths = with packages; [
    dumb_server
    extension
    tool
  ];
}
