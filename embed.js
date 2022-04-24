import Calculator from "./Calculator.svelte";

var div = document.createElement("div");
var script = document.currentScript;
script.parentNode.insertBefore(div, script);

const embed = new Calculator({
  target: div,
  props: { calcFontSize: calcFontSize },
});
