from _typeshed import Unused
from collections.abc import Callable, Iterable, Mapping
from typing import Literal

def is_array(checker: Unused, instance: object) -> bool: ...
def is_bool(checker: Unused, instance: object) -> bool: ...
def is_integer(checker: Unused, instance: object) -> bool: ...
def is_null(checker: Unused, instance: object) -> bool: ...
def is_number(checker: Unused, instance: object) -> bool: ...
def is_object(checker: Unused, instance: object) -> bool: ...
def is_string(checker: Unused, instance: object) -> bool: ...
def is_any(checker: Unused, instance: Unused) -> Literal[True]: ...

class TypeChecker:
    def __init__(self, type_checkers: Mapping[str, Callable[[object], bool]] = ...) -> None: ...
    def is_type(self, instance, type: str) -> bool: ...
    def redefine(self, type: str, fn: Callable[..., bool]) -> TypeChecker: ...
    def redefine_many(self, definitions=()) -> TypeChecker: ...
    def remove(self, *types: Iterable[str]) -> TypeChecker: ...

draft3_type_checker: TypeChecker
draft4_type_checker: TypeChecker
draft6_type_checker: TypeChecker
draft7_type_checker: TypeChecker
draft201909_type_checker: TypeChecker
draft202012_type_checker: TypeChecker
