use std::path::{Path, PathBuf};
use std::process::Command;

const REQUIRED_CONFIGURATION: [&str; 3] =
    ["--disable-gpl", "--disable-nonfree", "--disable-autodetect"];

const FORBIDDEN_CONFIGURATION: [&str; 5] = [
    "--enable-gpl",
    "--enable-nonfree",
    "--enable-libx264",
    "--enable-libx265",
    "--enable-libvmaf",
];

pub fn ensure_ffmpeg_binary() {
    let target = std::env::var("TARGET")
        .or_else(|_| std::env::var("HOST"))
        .expect("Neither TARGET nor HOST environment variable set");
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR")
            .expect("CARGO_MANIFEST_DIR environment variable not set"),
    );
    let extension = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let binary_path = manifest_dir
        .join("binaries")
        .join(format!("ffmpeg-{target}{extension}"));

    println!("cargo:rerun-if-changed={}", binary_path.display());
    println!("cargo:rerun-if-changed=../../scripts/build-ffmpeg-lgpl.sh");
    println!("cargo:rerun-if-changed=../../third-party/ffmpeg/VERSION.txt");
    println!("cargo:rerun-if-changed=../../third-party/ffmpeg/SHA256SUMS");

    if !binary_path.is_file() {
        panic!(
            "Reviewed FFmpeg sidecar is missing at {}. Run `scripts/build-ffmpeg-lgpl.sh {}` before building Tauri.",
            binary_path.display(),
            target
        );
    }

    if let Err(error) = verify_ffmpeg_license(&binary_path) {
        panic!("FFmpeg sidecar license verification failed: {error}");
    }
}

fn command_output(path: &Path, argument: &str) -> Result<String, String> {
    let output = Command::new(path)
        .args(["-hide_banner", argument])
        .output()
        .map_err(|error| format!("could not execute {}: {error}", path.display()))?;

    if !output.status.success() {
        return Err(format!(
            "{} {} exited with {}: {}",
            path.display(),
            argument,
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    ))
}

fn verify_ffmpeg_license(path: &Path) -> Result<(), String> {
    let build_configuration = command_output(path, "-buildconf")?;
    let license_output = command_output(path, "-L")?;
    let combined = format!("{build_configuration}\n{license_output}").to_lowercase();

    let forbidden: Vec<&str> = FORBIDDEN_CONFIGURATION
        .iter()
        .copied()
        .filter(|value| combined.contains(value))
        .collect();
    if !forbidden.is_empty() {
        return Err(format!(
            "forbidden configuration detected: {}",
            forbidden.join(", ")
        ));
    }

    for required in REQUIRED_CONFIGURATION {
        if !combined.contains(required) {
            return Err(format!("required configuration missing: {required}"));
        }
    }

    let license_lower = license_output.to_lowercase();
    if !license_lower.contains("lesser general public license") && !license_lower.contains("lgpl") {
        return Err("binary does not report an LGPL license".to_string());
    }

    println!(
        "cargo:warning=Accepted reviewed LGPL FFmpeg sidecar: {}",
        path.display()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{FORBIDDEN_CONFIGURATION, REQUIRED_CONFIGURATION};

    #[test]
    fn reviewed_configuration_contract_is_strict() {
        assert!(REQUIRED_CONFIGURATION.contains(&"--disable-gpl"));
        assert!(REQUIRED_CONFIGURATION.contains(&"--disable-nonfree"));
        assert!(REQUIRED_CONFIGURATION.contains(&"--disable-autodetect"));
        assert!(FORBIDDEN_CONFIGURATION.contains(&"--enable-gpl"));
        assert!(FORBIDDEN_CONFIGURATION.contains(&"--enable-libx264"));
        assert!(FORBIDDEN_CONFIGURATION.contains(&"--enable-libx265"));
        assert!(FORBIDDEN_CONFIGURATION.contains(&"--enable-libvmaf"));
    }
}
