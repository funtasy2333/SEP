import pypdfium2 as pdfium

pdf_path = r"C:\Users\92569\Downloads\标准文件.pdf"
out_dir = r"C:\Users\92569\Downloads"

pdf = pdfium.PdfDocument(pdf_path)
print(f"Total pages: {len(pdf)}")

for i in range(len(pdf)):
    page = pdf[i]
    bitmap = page.render(scale=2)
    pil_image = bitmap.to_pil()
    out_path = f"{out_dir}\\pdf_new_page{i+1}.png"
    pil_image.save(out_path)
    print(f"Saved: {out_path} ({pil_image.size[0]}x{pil_image.size[1]})")

pdf.close()
print("Done")
