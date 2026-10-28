      *================================================================
      * INVBATCH - NIGHTLY INVOICE BATCH
      * READS THE DAY'S ORDERS, VALIDATES THE CUSTOMER, PRICES THE
      * ORDER AND HANDS THE INVOICE TO THE OUTPUT PROGRAM.
      *================================================================
       IDENTIFICATION DIVISION.
       PROGRAM-ID. INVBATCH.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT ORDER-FILE    ASSIGN TO ORDERS.
           SELECT CUSTOMER-FILE ASSIGN TO CUSTMAST
               ORGANIZATION IS INDEXED
               ACCESS MODE IS RANDOM
               RECORD KEY IS CUST-ID.
           SELECT CONTROL-FILE  ASSIGN TO CTLFILE.
           SELECT REJECT-FILE   ASSIGN TO REJECTS.
       DATA DIVISION.
       FILE SECTION.
       FD  ORDER-FILE.
       COPY ORDREC.
       FD  CUSTOMER-FILE.
       COPY CUSTREC.
       FD  CONTROL-FILE.
       01  CONTROL-RECORD.
           05  CTL-OUTPUT-PGM     PIC X(8).
           05  FILLER             PIC X(72).
       FD  REJECT-FILE.
       01  REJECT-RECORD.
           05  REJ-ORDER-ID       PIC X(10).
           05  REJ-REASON         PIC X(2).
       WORKING-STORAGE SECTION.
       01  WS-FLAGS.
           05  WS-EOF             PIC X VALUE 'N'.
               88  END-OF-ORDERS        VALUE 'Y'.
       01  WS-OUTPUT-PGM          PIC X(8).
       01  WS-RESULT              PIC X(2).
       01  WS-INVOICE.
           05  WS-SUBTOTAL        PIC S9(7)V99 COMP-3.
           05  WS-TOTAL           PIC S9(7)V99 COMP-3.
       PROCEDURE DIVISION.
       0000-MAIN.
           OPEN INPUT ORDER-FILE CUSTOMER-FILE CONTROL-FILE
                OUTPUT REJECT-FILE
           READ CONTROL-FILE
           MOVE CTL-OUTPUT-PGM TO WS-OUTPUT-PGM
           PERFORM UNTIL END-OF-ORDERS
               READ ORDER-FILE
                   AT END SET END-OF-ORDERS TO TRUE
                   NOT AT END PERFORM 1000-PROCESS-ORDER
               END-READ
           END-PERFORM
           CLOSE ORDER-FILE CUSTOMER-FILE CONTROL-FILE REJECT-FILE
           STOP RUN.
       1000-PROCESS-ORDER.
           MOVE ORD-CUST-ID TO CUST-ID
           MOVE '00' TO WS-RESULT
           READ CUSTOMER-FILE
               INVALID KEY MOVE '30' TO WS-RESULT
           END-READ
           COMPUTE WS-SUBTOTAL = ORD-QUANTITY * ORD-UNIT-PRICE
           IF WS-RESULT = '00'
               CALL 'CUSTVAL' USING CUSTOMER-RECORD WS-SUBTOTAL
                                    WS-RESULT
           END-IF
           IF WS-RESULT NOT = '00'
               MOVE ORD-ID TO REJ-ORDER-ID
               MOVE WS-RESULT TO REJ-REASON
               WRITE REJECT-RECORD
           ELSE
               CALL 'INVCALC' USING ORDER-RECORD CUSTOMER-RECORD
                                    WS-INVOICE
               CALL WS-OUTPUT-PGM USING ORDER-RECORD WS-INVOICE
           END-IF.
