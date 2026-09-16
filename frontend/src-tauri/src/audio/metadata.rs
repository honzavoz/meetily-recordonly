use anyhow::{anyhow, Result};
use log::debug;
use std::path::Path;

pub(crate) fn extract_duration_from_metadata(path: &Path) -> Result<f64> {
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    // Open the file
    let file =
        std::fs::File::open(path).map_err(|e| anyhow!("Failed to open audio file: {}", e))?;

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    // Set up format hint based on file extension
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    // Probe the file format (lightweight operation)
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| anyhow!("Failed to probe audio format: {}", e))?;

    let format = probed.format;

    // Find the first audio track
    use symphonia::core::codecs::CODEC_TYPE_NULL;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| anyhow!("No audio track found in file"))?;

    // Extract duration from metadata
    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| anyhow!("Unknown sample rate"))?;

    let n_frames = track
        .codec_params
        .n_frames
        .ok_or_else(|| anyhow!("Frame count not available in metadata"))?;

    let duration_seconds = n_frames as f64 / sample_rate as f64;

    debug!(
        "Extracted metadata: {}Hz, {} frames, {:.2}s",
        sample_rate, n_frames, duration_seconds
    );

    Ok(duration_seconds)
}
