{ pkgs ? import <nixpkgs> {}
, developer ? false
}:

let packages = import ./packages.nix { inherit pkgs developer; }; in

pkgs.buildEnv {
  name = "hoardy-web-env-20250124";
  paths = with packages; [
    simple_server
    extension
    tool
  ];
}
