from django.db.models import F
from rest_framework.filters import OrderingFilter


class TableOrderingFilter(OrderingFilter):
    def filter_queryset(self, request, queryset, view):
        ordering = self.get_ordering(request, queryset, view)
        if not ordering:
            return queryset
        aliases = getattr(view, "ordering_aliases", {})
        expressions = []
        for item in ordering:
            field = item.lstrip("-")
            expression = F(aliases.get(field, field))
            expressions.append(
                expression.desc(nulls_last=True)
                if item.startswith("-")
                else expression.asc(nulls_last=True)
            )
        return queryset.order_by(*expressions, "pk")
