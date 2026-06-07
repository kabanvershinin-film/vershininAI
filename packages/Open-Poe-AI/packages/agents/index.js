"use client";

import React from "react";

function StubPage({ label }) {
  return React.createElement(
    "div",
    {
      style: {
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#050505",
        color: "rgba(255,255,255,0.72)",
        fontFamily: "sans-serif",
      },
    },
    `${label} submodule is not installed in this local checkout.`
  );
}

export function AiAgent() {
  return React.createElement(StubPage, { label: "AI Agent" });
}

export function CreateAgentPage() {
  return React.createElement(StubPage, { label: "Create Agent" });
}

export function EditAgentPage() {
  return React.createElement(StubPage, { label: "Edit Agent" });
}
