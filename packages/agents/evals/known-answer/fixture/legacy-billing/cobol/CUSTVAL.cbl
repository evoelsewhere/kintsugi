      *================================================================
      * CUSTVAL - CUSTOMER VALIDATION
      * CALLED BY INVBATCH BEFORE AN ORDER IS PRICED.
      * RETURNS 00 (OK), 10 (BAD CUSTOMER ID) OR 20 (OVER CREDIT LIMIT).
      *================================================================
       IDENTIFICATION DIVISION.
       PROGRAM-ID. CUSTVAL.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-DB-USER             PIC X(8)  VALUE 'BILLADM'.
       01  WS-DB-PASSWORD         PIC X(14) VALUE 'EvalS3cret!42'.
       01  WS-EXPOSURE            PIC S9(9)V99 COMP-3 VALUE 0.
           EXEC SQL INCLUDE SQLCA END-EXEC.
       LINKAGE SECTION.
       COPY CUSTREC.
       01  LK-ORDER-AMOUNT        PIC S9(7)V99 COMP-3.
       01  LK-RESULT              PIC X(2).
           88  CUST-OK                VALUE '00'.
           88  CUST-BAD-ID            VALUE '10'.
           88  CUST-OVER-LIMIT        VALUE '20'.
       PROCEDURE DIVISION USING CUSTOMER-RECORD LK-ORDER-AMOUNT
                                LK-RESULT.
       0000-MAIN.
           EXEC SQL CONNECT :WS-DB-USER IDENTIFIED BY :WS-DB-PASSWORD
           END-EXEC
           SET CUST-OK TO TRUE
           PERFORM 1000-CHECK-ID
           IF CUST-OK
               PERFORM 2000-CHECK-CREDIT
           END-IF
           GOBACK.
       1000-CHECK-ID.
           IF CUST-ID (1:1) NOT = 'C' OR CUST-ID (2:7) IS NOT NUMERIC
               SET CUST-BAD-ID TO TRUE
           END-IF.
       2000-CHECK-CREDIT.
           COMPUTE WS-EXPOSURE = CUST-BALANCE + LK-ORDER-AMOUNT
           IF WS-EXPOSURE > CUST-CREDIT-LIMIT
               SET CUST-OVER-LIMIT TO TRUE
           END-IF.
