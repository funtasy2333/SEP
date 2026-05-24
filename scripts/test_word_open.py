# -*- coding: utf-8 -*-
import sys, io, pathlib
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

downloads = pathlib.Path(r"C:\Users\92569\Downloads")
candidates = sorted(downloads.glob("*.docx"), key=lambda p: p.stat().st_mtime, reverse=True)
docx_path = candidates[0]
print(f"Trying to open: {docx_path.name} ({docx_path.stat().st_size} bytes)")

import win32com.client
try:
    word = win32com.client.Dispatch("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0  # wdAlertsNone
    doc = word.Documents.Open(str(docx_path.resolve()))
    print(f"SUCCESS: Word opened the file!")
    print(f"  Paragraphs: {doc.Paragraphs.Count}")
    print(f"  Pages: {doc.ComputeStatistics(2)}")  # wdStatisticPages = 2
    doc.Close(0)
    word.Quit()
except Exception as e:
    print(f"FAILED: {e}")
    try:
        word.Quit()
    except:
        pass
