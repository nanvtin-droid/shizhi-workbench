import Foundation
import ImageIO
import CoreGraphics

func prepare() throws {
    let args = CommandLine.arguments
    guard args.count == 3, let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw NSError(domain: "ImageInput", code: 1) }
    let side = 2048, stride = 1920
    let rows = image.height > side ? Array(Swift.stride(from: 0, to: image.height, by: stride)) : [0]
    let cols = image.width > side ? Array(Swift.stride(from: 0, to: image.width, by: stride)) : [0]
    guard rows.count * cols.count <= 200 else { throw NSError(domain: "ImageTooLarge", code: 2) }
    var parts: [[String: Any]] = []
    for y in rows { for x in cols {
        let width = min(cols.count > 1 ? side : image.width, image.width - x)
        let height = min(rows.count > 1 ? side : image.height, image.height - y)
        guard let crop = image.cropping(to: CGRect(x: x, y: y, width: width, height: height)) else { throw NSError(domain: "ImageCrop", code: 3) }
        let file = "\(args[2])/part-\(parts.count + 1).png"
        guard let output = CGImageDestinationCreateWithURL(URL(fileURLWithPath: file) as CFURL, "public.png" as CFString, 1, nil) else { throw NSError(domain: "ImageOutput", code: 4) }
        CGImageDestinationAddImage(output, crop, nil)
        guard CGImageDestinationFinalize(output) else { throw NSError(domain: "ImageWrite", code: 5) }
        parts.append(["file": file, "x": x, "y": y, "width": width, "height": height])
    } }
    let data = try JSONSerialization.data(withJSONObject: ["width": image.width, "height": image.height, "parts": parts])
    print(String(data: data, encoding: .utf8)!)
}
do { try prepare() } catch { fputs("原图分段失败：\(error)\n", stderr); exit(1) }
