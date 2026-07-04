use std::path::Path;

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

fn prepare_dist() -> std::io::Result<()> {
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("dist");
    if out.exists() {
        std::fs::remove_dir_all(&out)?;
    }
    let src = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("dist");
    if src.exists() {
        copy_dir(&src, &out)
    } else {
        std::fs::create_dir_all(&out)?;
        std::fs::write(
            out.join("index.html"),
            "<!doctype html><html><body></body></html>",
        )
    }
}

fn main() {
    println!("cargo:rerun-if-changed=dist");
    prepare_dist().expect("failed to prepare embedded dist");
    #[cfg(feature = "desktop")]
    tauri_build::build()
}
