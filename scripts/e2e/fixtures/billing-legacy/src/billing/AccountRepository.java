package billing;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

/** Reads accounts from the ACCOUNT table. */
public class AccountRepository {
    private final Connection connection;

    public AccountRepository(Connection connection) {
        this.connection = connection;
    }

    public Account find(String id) {
        try (PreparedStatement statement = connection.prepareStatement("SELECT BALANCE, RATE, DAYS_OVERDUE FROM ACCOUNT WHERE ID = ?")) {
            statement.setString(1, id);
            try (ResultSet row = statement.executeQuery()) {
                if (!row.next()) throw new IllegalArgumentException("unknown account " + id);
                return new Account(id, row.getBigDecimal(1), row.getBigDecimal(2), row.getInt(3));
            }
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }
}
