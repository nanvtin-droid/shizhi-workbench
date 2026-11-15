import Foundation
import Vision

let paths = Array(CommandLine.arguments.dropFirst())
if paths.isEmpty { fputs("需要提供图片路径\n", stderr); exit(1) }
var pages: [[String: Any]] = []
for (index, imagePath) in paths.enumerated() {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    request.minimumTextHeight = 0.005
    do {
        try VNImageRequestHandler(url: URL(fileURLWithPath: imagePath)).perform([request])
        let observations: [VNRecognizedTextObservation] = request.results ?? []
        var lines: [String] = []
        for observation in observations {
            let candidates: [VNRecognizedText] = observation.topCandidates(1)
            if let candidate = candidates.first { lines.append(candidate.string) }
        }
        let text: String = lines.joined(separator: "\n")
        pages.append(["page": index + 1, "text": text])
    } catch {
        fputs("图片文字识别失败：\(error.localizedDescription)\n", stderr)
        exit(1)
    }
}
let result: [String: Any] = ["pages": pages]
let json = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
FileHandle.standardOutput.write(json)
