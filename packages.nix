{ pkgs ? import <nixpkgs> {}
, developer ? false
}:

let
  source = import ./source.nix { inherit pkgs; };
  args = { inherit pkgs source developer; };
in

{
  simple_server = import ./simple_server args;
  extension = import ./extension args;
  tool = import ./tool args;
}
