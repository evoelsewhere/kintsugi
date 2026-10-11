package billing;

import java.math.BigDecimal;

public record Invoice(String accountId, BigDecimal total, BigDecimal interest, BigDecimal lateFee) {}
