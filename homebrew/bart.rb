class Bart < Formula
  desc "AI-powered TDD task runner for software development"
  homepage "https://github.com/leandrostoroli/bart-loop"
  url "https://github.com/leandrostoroli/bart-loop/archive/refs/tags/v#{version}.tar.gz"
  sha256 "PLACEHOLDER_SHA256"
  license "MIT"

  depends_on "bun"

  def install
    libexec.install Dir["*"]
    cd libexec do
      system "bun", "install", "--production"
    end
    (bin/"bart").write <<~SH
      #!/bin/bash
      exec bun "#{libexec}/src/index.ts" "$@"
    SH
  end

  test do
    system bin/"bart", "--help"
  end
end
