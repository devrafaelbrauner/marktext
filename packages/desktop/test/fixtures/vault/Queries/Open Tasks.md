# Open tasks

```dataview
TASK
FROM #project
WHERE !completed
SORT due ASC
```

Projects table:

```dataview
TABLE status, priority
FROM "Projects"
```
