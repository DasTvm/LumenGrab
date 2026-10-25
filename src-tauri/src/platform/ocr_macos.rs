//! Text recognition with Apple's Vision framework (`VNRecognizeTextRequest`). On the device, no network.

use objc2::{rc::Retained, AnyThread};
use objc2_foundation::{NSArray, NSData, NSDictionary};
use objc2_vision::{
    VNImageRequestHandler, VNRecognizeTextRequest, VNRequest, VNRequestTextRecognitionLevel,
};

use crate::{capture::Frame, ocr::Line};

/// Reads the text lines of a PNG. Boxes come back in pixels of `frame`, origin top-left (Vision
/// reports them normalised with the origin at the bottom-left).
pub fn recognize_text(png: &[u8], frame: &Frame) -> Result<Vec<Line>, String> {
    objc2::rc::autoreleasepool(|_| {
        let data = NSData::with_bytes(png);
        let options = NSDictionary::new();
        let handler = VNImageRequestHandler::initWithData_options(
            VNImageRequestHandler::alloc(),
            &data,
            &options,
        );
        let request = VNRecognizeTextRequest::new();
        request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
        request.setUsesLanguageCorrection(true);
        request.setAutomaticallyDetectsLanguage(true);
        let base: Retained<VNRequest> = Retained::into_super(Retained::into_super(request.clone()));
        let requests = NSArray::from_retained_slice(&[base]);
        handler
            .performRequests_error(&requests)
            .map_err(|e| e.localizedDescription().to_string())?;
        let (width, height) = (f64::from(frame.width), f64::from(frame.height));
        let mut lines = Vec::new();
        let Some(results) = request.results() else {
            return Ok(lines);
        };
        for observation in results.iter() {
            let candidates = observation.topCandidates(1);
            let Some(best) = candidates.iter().next() else {
                continue;
            };
            let text = best.string().to_string();
            // SAFETY: a plain getter of a finished observation.
            let b = unsafe { observation.boundingBox() };
            lines.push(Line {
                text,
                x: b.origin.x * width,
                y: (1.0 - b.origin.y - b.size.height) * height,
                width: b.size.width * width,
                height: b.size.height * height,
            });
        }
        Ok(lines)
    })
}
