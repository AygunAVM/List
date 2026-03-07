' ═══════════════════════════════════════════════════════════════
'  AYGÜN AVM — MakroVBA.bas
'  Amaç: Excel'den Teklifler/Satışlar verisini JSON'a dönüştür
'  Kullanım: Alt+F11 > Insert > Module > Bu kodu yapıştır
' ═══════════════════════════════════════════════════════════════

Option Explicit

' ─── TEKLIFLER TABLOSUNDAN JSON OLUŞTUR ───
Sub ExportProposalsToJSON()
    Dim ws As Worksheet
    Dim jsonOutput As String
    Dim i As Long, lastRow As Long
    Dim custName, phone, odeme, nakit As String
    Dim ts, user, durum, not As String
    Dim id As String
    
    ' Teklifler sayfasını aç
    On Error Resume Next
    Set ws = ThisWorkbook.Sheets("Teklifler")
    If ws Is Nothing Then
        MsgBox "Teklifler sayfası bulunamadı!", vbCritical
        Exit Sub
    End If
    On Error GoTo 0
    
    lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
    jsonOutput = "["
    
    ' Başlık satırı atla (1. satır)
    For i = 2 To lastRow
        If ws.Cells(i, 1).Value <> "" Then
            ' Sütunları oku: A=Ad, B=Telefon, C=Ödeme, D=Tutar, E=Tarih, F=Kullanıcı, G=Durum
            id = GenerateUID()
            custName = ws.Cells(i, 1).Value
            phone = ws.Cells(i, 2).Value
            odeme = ws.Cells(i, 3).Value
            nakit = ws.Cells(i, 4).Value
            ts = ws.Cells(i, 5).Value
            user = ws.Cells(i, 6).Value
            durum = ws.Cells(i, 7).Value
            not = ws.Cells(i, 8).Value
            
            jsonOutput = jsonOutput & "," & vbCrLf & "{" & vbCrLf
            jsonOutput = jsonOutput & "  ""id"": """ & id & """," & vbCrLf
            jsonOutput = jsonOutput & "  ""custName"": """ & Escape(custName) & """," & vbCrLf
            jsonOutput = jsonOutput & "  ""phone"": """ & phone & """," & vbCrLf
            jsonOutput = jsonOutput & "  ""odeme"": """ & Escape(odeme) & """," & vbCrLf
            jsonOutput = jsonOutput & "  ""nakit"": " & nakit & "," & vbCrLf
            jsonOutput = jsonOutput & "  ""ts"": """ & Format(ts, "yyyy-mm-dd'T'hh:mm:ss'Z'") & """," & vbCrLf
            jsonOutput = jsonOutput & "  ""user"": """ & user & """," & vbCrLf
            jsonOutput = jsonOutput & "  ""durum"": """ & durum & """," & vbCrLf
            jsonOutput = jsonOutput & "  ""not"": """ & Escape(not) & """," & vbCrLf
            jsonOutput = jsonOutput & "  ""selectedOption"": ""taksit""," & vbCrLf
            jsonOutput = jsonOutput & "  ""type"": ""proposal""" & vbCrLf
            jsonOutput = jsonOutput & "}"
        End If
    Next i
    
    jsonOutput = jsonOutput & vbCrLf & "]"
    
    ' JSON'u pano kopyala
    CreateObject("new:{1C3B4210-F441-11CE-B9EA-00AA006B1A69}").SetText jsonOutput
    
    MsgBox "Teklifler JSON'u oluşturuldu!" & vbCrLf & _
           "Index.html'de tarayıcı konsoluna yapıştır:" & vbCrLf & _
           "localStorage.setItem('aygun_proposals', '" & Left(jsonOutput, 100) & "...')", vbInformation
End Sub

' ─── SATIŞLAR TABLOSUNDAN JSON OLUŞTUR ───
Sub ExportSalesToJSON()
    Dim ws As Worksheet
    Dim jsonOutput As String
    Dim i As Long, lastRow As Long
    Dim custName, custPhone, method, address As String
    Dim nakit As String
    Dim ts, user As String
    Dim id As String
    
    ' Satışlar sayfasını aç
    On Error Resume Next
    Set ws = ThisWorkbook.Sheets("Satışlar")
    If ws Is Nothing Then
        MsgBox "Satışlar sayfası bulunamadı!", vbCritical
        Exit Sub
    End If
    On Error GoTo 0
    
    lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
    jsonOutput = "["
    
    ' Başlık satırı atla
    For i = 2 To lastRow
        If ws.Cells(i, 1).Value <> "" Then
            id = "SAT-" & Format(Now(), "yyyymmddhhmmss")
            custName = ws.Cells(i, 1).Value
            custPhone = ws.Cells(i, 2).Value
            method = ws.Cells(i, 3).Value
            address = ws.Cells(i, 4).Value
            nakit = ws.Cells(i, 5).Value
            ts = ws.Cells(i, 6).Value
            user = ws.Cells(i, 7).Value
            
            jsonOutput = jsonOutput & "," & vbCrLf & "{" & vbCrLf
            jsonOutput = jsonOutput & "  ""id"": """ & id & """," & vbCrLf
            jsonOutput = jsonOutput & "  ""custName"": """ & Escape(custName) & """," & vbCrLf
            jsonOutput = jsonOutput & "  ""custPhone"": """ & custPhone & """," & vbCrLf
            jsonOutput = jsonOutput & "  ""method"": """ & method & """," & vbCrLf
            jsonOutput = jsonOutput & "  ""address"": """ & Escape(address) & """," & vbCrLf
            jsonOutput = jsonOutput & "  ""nakit"": " & nakit & "," & vbCrLf
            jsonOutput = jsonOutput & "  ""ts"": """ & Format(ts, "yyyy-mm-dd'T'hh:mm:ss'Z'") & """," & vbCrLf
            jsonOutput = jsonOutput & "  ""user"": """ & user & """," & vbCrLf
            jsonOutput = jsonOutput & "  ""type"": ""sale""" & vbCrLf
            jsonOutput = jsonOutput & "}"
        End If
    Next i
    
    jsonOutput = jsonOutput & vbCrLf & "]"
    
    CreateObject("new:{1C3B4210-F441-11CE-B9EA-00AA006B1A69}").SetText jsonOutput
    
    MsgBox "Satışlar JSON'u oluşturuldu!", vbInformation
End Sub

' ─── HELPER: JSON STRING ESCAPE ───
Function Escape(inputStr As String) As String
    Escape = Replace(inputStr, """", "\""")
    Escape = Replace(Escape, vbCrLf, "\n")
    Escape = Replace(Escape, vbLf, "\n")
    Escape = Replace(Escape, vbCr, "\r")
End Function

' ─── HELPER: UNIQUE ID OLUŞTUR ───
Function GenerateUID() As String
    Dim chars As String
    Dim i As Long, result As String
    Dim randNum As Long
    
    chars = "abcdefghijklmnopqrstuvwxyz0123456789"
    Randomize
    
    For i = 1 To 9
        randNum = Int(Rnd() * Len(chars)) + 1
        result = result & Mid(chars, randNum, 1)
    Next i
    
    GenerateUID = result
End Function

' ─── KULLANCILAR JSON'U OLUŞTUR ───
Sub CreateUsersJSON()
    Dim jsonOutput As String
    
    jsonOutput = "[" & vbCrLf
    jsonOutput = jsonOutput & "  {" & vbCrLf
    jsonOutput = jsonOutput & "    ""Email"": ""demo@example.com""," & vbCrLf
    jsonOutput = jsonOutput & "    ""Sifre"": ""demo123""," & vbCrLf
    jsonOutput = jsonOutput & "    ""Rol"": ""satış""" & vbCrLf
    jsonOutput = jsonOutput & "  }," & vbCrLf
    jsonOutput = jsonOutput & "  {" & vbCrLf
    jsonOutput = jsonOutput & "    ""Email"": ""admin@aygungroup.com""," & vbCrLf
    jsonOutput = jsonOutput & "    ""Sifre"": ""admin123""," & vbCrLf
    jsonOutput = jsonOutput & "    ""Rol"": ""admin""" & vbCrLf
    jsonOutput = jsonOutput & "  }" & vbCrLf
    jsonOutput = jsonOutput & "]"
    
    CreateObject("new:{1C3B4210-F441-11CE-B9EA-00AA006B1A69}").SetText jsonOutput
    
    MsgBox "Kullanıcılar JSON'u oluşturuldu!" & vbCrLf & _
           "Bunu kullanıcılar.json'a yapıştır.", vbInformation
End Sub

' ─── ÜRÜNLER JSON'U OLUŞTUR (ÖRNEKLE) ───
Sub CreateSampleProductsJSON()
    Dim jsonOutput As String
    
    jsonOutput = "[" & vbCrLf
    jsonOutput = jsonOutput & "  {" & vbCrLf
    jsonOutput = jsonOutput & "    ""Urun"": ""Masaüstü Bilgisayar""," & vbCrLf
    jsonOutput = jsonOutput & "    ""Kod"": ""MST001""," & vbCrLf
    jsonOutput = jsonOutput & "    ""Stok"": 5," & vbCrLf
    jsonOutput = jsonOutput & "    ""D.Kart"": 15000," & vbCrLf
    jsonOutput = jsonOutput & "    ""4T AWM"": 14500," & vbCrLf
    jsonOutput = jsonOutput & "    ""Tek Cekim"": 15200," & vbCrLf
    jsonOutput = jsonOutput & "    ""Nakit"": 14800," & vbCrLf
    jsonOutput = jsonOutput & "    ""Aciklama"": ""I5 Processor, 16GB RAM, 256GB SSD""," & vbCrLf
    jsonOutput = jsonOutput & "    ""Marka"": ""Dell""," & vbCrLf
    jsonOutput = jsonOutput & "    ""Gamdaki Yer"": ""Bilgisayarlar""" & vbCrLf
    jsonOutput = jsonOutput & "  }" & vbCrLf
    jsonOutput = jsonOutput & "]"
    
    CreateObject("new:{1C3B4210-F441-11CE-B9EA-00AA006B1A69}").SetText jsonOutput
    
    MsgBox "Örnek Ürünler JSON'u oluşturuldu!", vbInformation
End Sub
