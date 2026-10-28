      *================================================================
      * INVPRT - INVOICE PRINT LINE
      * FORMATS ONE INVOICE LINE AND WRITES IT TO THE INVOICES FILE.
      *================================================================
       IDENTIFICATION DIVISION.
       PROGRAM-ID. INVPRT.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT INVOICE-FILE ASSIGN TO INVOICES.
       DATA DIVISION.
       FILE SECTION.
       FD  INVOICE-FILE.
       01  INVOICE-LINE           PIC X(80).
       WORKING-STORAGE SECTION.
       01  WS-OPENED              PIC X VALUE 'N'.
       01  WS-LINE.
           05  WS-ORDER-ID        PIC X(10).
           05  FILLER             PIC X(2) VALUE SPACES.
           05  WS-AMOUNT          PIC Z,ZZZ,ZZ9.99.
           05  FILLER             PIC X(56) VALUE SPACES.
       LINKAGE SECTION.
       COPY ORDREC.
       01  LK-INVOICE.
           05  LK-SUBTOTAL        PIC S9(7)V99 COMP-3.
           05  LK-TOTAL           PIC S9(7)V99 COMP-3.
       PROCEDURE DIVISION USING ORDER-RECORD LK-INVOICE.
       0000-MAIN.
           IF WS-OPENED = 'N'
               OPEN EXTEND INVOICE-FILE
               MOVE 'Y' TO WS-OPENED
           END-IF
           MOVE ORD-ID TO WS-ORDER-ID
           MOVE LK-TOTAL TO WS-AMOUNT
           WRITE INVOICE-LINE FROM WS-LINE
           GOBACK.
