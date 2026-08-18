# CNB build image for Codex Desktop (Tauri 2).
# Pre-installs system libraries and toolchains required to build and test
# codex-desktop (Rust backend + React/Vite frontend) without re-installing
# them on every pipeline run. Mirrors the toolchain pinned by the repo's
# GitHub Actions workflows (rust-ci / sdk).
FROM debian:bookworm

# --- OS-level dependencies (Tauri 2 on Linux) ---
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    wget \
    file \
    pkg-config \
    ca-certificates \
    git \
    # Tauri runtime dependencies
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libssl-dev \
    libxdo-dev \
    libsoup-3.0-dev \
    javascriptcoregtk-4.1-dev \
    libappindicator3-dev \
    patchelf \
    # Node.js toolchain for the ui/ frontend
    nodejs \
    npm \
  && rm -rf /var/lib/apt/lists/*

# --- Install pnpm (matching root package.json) ---
RUN npm install -g pnpm@10.33.0

# --- Install stable Rust (matching codex-rs/rust-toolchain.toml) ---
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH \
    RUSTUP_DIST_SERVER=https://static.rust-lang.org \
    RUSTUP_UPDATE_ROOT=https://static.rust-lang.org/rustup

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain 1.95.0 \
  && rustup component add clippy rustfmt rust-src \
  && rustc --version && cargo --version

# --- Install Tauri CLI (v2) for bundling ---
RUN cargo install --locked tauri-cli --version "^2.0.0"

WORKDIR /workspace
