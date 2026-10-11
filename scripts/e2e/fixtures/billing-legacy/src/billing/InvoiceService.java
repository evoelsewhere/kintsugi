package billing;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** Builds the monthly invoice of an account. */
public class InvoiceService {
    private static final BigDecimal LATE_FEE = new BigDecimal("25.00");
    private final AccountRepository accounts;

    public InvoiceService(AccountRepository accounts) {
        this.accounts = accounts;
    }

    public Invoice monthly(String accountId) {
        Account account = accounts.find(accountId);
        BigDecimal interest = account.balance().multiply(account.rate()).divide(new BigDecimal("12"), 2, RoundingMode.HALF_UP);
        BigDecimal fee = account.daysOverdue() > 30 ? LATE_FEE : BigDecimal.ZERO;
        return new Invoice(accountId, account.balance().add(interest).add(fee), interest, fee);
    }
}
