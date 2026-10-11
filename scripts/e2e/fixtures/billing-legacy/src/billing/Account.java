package billing;

import java.math.BigDecimal;

public record Account(String id, BigDecimal balance, BigDecimal rate, int daysOverdue) {}
