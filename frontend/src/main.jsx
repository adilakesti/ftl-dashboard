import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { installViewAs } from "./viewAs.js";
import "./index.css";

installViewAs();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
