import { render } from "preact";

import { App } from "./App.js";

import "./styles.css";

const root = document.getElementById("app");
if (root !== null) {
  render(<App />, root);
}
