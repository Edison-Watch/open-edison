import warnings


def pytest_configure() -> None:
    warnings.filterwarnings(
        "ignore",
        message=r".*split_arg_string.*",
        category=DeprecationWarning,
        module=r".*",
    )
