#!/usr/bin/env swift
import Foundation
import Vision
import ImageIO

// Minimal macOS Vision OCR helper.
// Prints one JSON object per input path:
// { "path": "...", "ok": true, "text": "..." }
// { "path": "...", "ok": false, "error": "..." }

func cgImage(from url: URL) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
}

func jsonLine(_ obj: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    } else {
        // Fallback: never crash on serialization.
        let path = (obj["path"] as? String) ?? ""
        print("{\"path\":\(String(reflecting: path)),\"ok\":false,\"error\":\"json_encode_failed\"}")
    }
}

let args = Array(CommandLine.arguments.dropFirst())
if args.isEmpty {
    FileHandle.standardError.write(Data("usage: vision_ocr.swift <image1> [image2 ...]\n".utf8))
    exit(2)
}

for p in args {
    let url = URL(fileURLWithPath: p)
    guard let img = cgImage(from: url) else {
        jsonLine(["path": p, "ok": false, "error": "cannot_decode_image"])
        continue
    }

    var outText = ""
    var outErr: String? = nil

    let req = VNRecognizeTextRequest { request, error in
        if let error = error {
            outErr = String(describing: error)
            return
        }
        let obs = (request.results as? [VNRecognizedTextObservation]) ?? []
        let lines: [String] = obs.compactMap { $0.topCandidates(1).first?.string }
        outText = lines.joined(separator: "\n")
    }

    // Receipts/invoices can include Arabic/French/English in Lebanon.
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    req.recognitionLanguages = ["en-US", "fr-FR", "ar-SA"]

    do {
        let handler = VNImageRequestHandler(cgImage: img, options: [:])
        try handler.perform([req])
        if let e = outErr {
            jsonLine(["path": p, "ok": false, "error": e])
        } else {
            jsonLine(["path": p, "ok": true, "text": outText])
        }
    } catch {
        jsonLine(["path": p, "ok": false, "error": String(describing: error)])
    }
}

