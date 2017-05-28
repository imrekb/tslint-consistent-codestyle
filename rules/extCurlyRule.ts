import * as ts from 'typescript';
import * as Lint from 'tslint';
import * as utils from 'tsutils';

const FAIL_MESSAGE_MISSING = `statement must be braced`;
const FAIL_MESSAGE_UNNECESSARY = `unnecessary curly braces`;

const OPTION_ELSE = 'else';
const OPTION_CONSISTENT = 'consistent';
const OPTION_BRACED_CHILD = 'braced-child';
const OPTION_NESTED_IF_ELSE = 'nested-if-else';

interface IOptions {
    else: boolean;
    consistent: boolean;
    child: boolean;
    nestedIfElse: boolean;
}

export class Rule extends Lint.Rules.AbstractRule {
    public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
        return this.applyWithWalker(new ExtCurlyWalker(sourceFile, this.ruleName, {
            else: this.ruleArguments.indexOf(OPTION_ELSE) !== -1,
            consistent: this.ruleArguments.indexOf(OPTION_CONSISTENT) !== -1,
            child: this.ruleArguments.indexOf(OPTION_BRACED_CHILD) !== -1,
            nestedIfElse: this.ruleArguments.indexOf(OPTION_NESTED_IF_ELSE) !== -1,
        }));
    }
}

class ExtCurlyWalker extends Lint.AbstractWalker<IOptions> {
    public walk(sourceFile: ts.SourceFile) {
        const cb = (node: ts.Node): void => {
            if (utils.isIterationStatement(node)) {
                this._checkLoop(node);
            } else if (utils.isIfStatement(node)) {
                this._checkIfStatement(node);
            }
            return ts.forEachChild(node, cb);
        };
        return ts.forEachChild(sourceFile, cb);
    }

    private _checkLoop(node: ts.IterationStatement) {
        if (this._needsBraces(node.statement)) {
            if (node.statement.kind !== ts.SyntaxKind.Block)
                this.addFailureAtNode(node.statement, FAIL_MESSAGE_MISSING);
        } else if (node.statement.kind === ts.SyntaxKind.Block) {
            this._reportUnnecessary(<ts.Block>node.statement);
        }
    }

    private _checkIfStatement(node: ts.IfStatement) {
        const [then, otherwise] = this._ifStatementNeedsBraces(node);
        if (then) {
            if (node.thenStatement.kind !== ts.SyntaxKind.Block)
                this.addFailureAtNode(node.thenStatement, FAIL_MESSAGE_MISSING);
        } else if (node.thenStatement.kind === ts.SyntaxKind.Block) {
            this._reportUnnecessaryThen(node);
        }
        if (otherwise) {
            if (node.elseStatement !== undefined &&
                node.elseStatement.kind !== ts.SyntaxKind.Block && node.elseStatement.kind !== ts.SyntaxKind.IfStatement)
                this.addFailureAtNode(node.elseStatement, FAIL_MESSAGE_MISSING);
        } else if (node.elseStatement !== undefined && node.elseStatement.kind === ts.SyntaxKind.Block) {
            this._reportUnnecessary(<ts.Block>node.elseStatement);
        }
    }

    private _needsBraces(node: ts.Statement, allowIfElse?: boolean): boolean {
        if (utils.isBlock(node))
            return node.statements.length !== 1 || this._needsBraces(node.statements[0], allowIfElse);
        if (!allowIfElse && this.options.nestedIfElse && utils.isIfStatement(node) && node.elseStatement !== undefined)
            return true;
        if (!this.options.child)
            return false;
        if (utils.isIfStatement(node)) {
            const result  = this._ifStatementNeedsBraces(node);
            return result[0] || result[1];
        }
        if (utils.isIterationStatement(node))
            return this._needsBraces(node.statement);
        return node.kind === ts.SyntaxKind.SwitchStatement;
    }

    private _ifStatementNeedsBraces(node: ts.IfStatement, excludeElse?: boolean): [boolean, boolean] {
        if (this.options.else && (node.elseStatement !== undefined || getElseIfParent(node) !== undefined))
                return [true, true];
        if (this.options.consistent) {
            if (this._needsBraces(node.thenStatement) ||
                !excludeElse && node.elseStatement !== undefined && this._needsBraces(node.elseStatement, true))
                return [true, true];
            const parentIf = getElseIfParent(node);
            if (parentIf !== undefined && this._ifStatementNeedsBraces(parentIf, true)[0])
                return [true, true];
        }
        if (node.elseStatement !== undefined) {
            const statement = unwrapBlock(node.thenStatement);
            return [
                utils.isIfStatement(statement) && statement.elseStatement === undefined,
                !excludeElse && this._needsBraces(node.elseStatement, true),
            ];
        }
        return [this._needsBraces(node.thenStatement), false];
    }

    private _reportUnnecessary(block: ts.Block) {
        this.addFailure(block.statements.pos - 1, block.end, FAIL_MESSAGE_UNNECESSARY, [
            Lint.Replacement.deleteFromTo(block.pos, block.statements.pos),
            Lint.Replacement.deleteFromTo(block.statements.end, block.end),
        ]);
    }

    private _reportUnnecessaryThen(node: ts.IfStatement) {
        const block = <ts.Block>node.thenStatement;
        let closeBraceFix: Lint.Replacement;
        if (node.elseStatement !== undefined) {
            closeBraceFix = Lint.Replacement.deleteFromTo(
                node.getChildAt(4, this.sourceFile).end - 1,
                node.getChildAt(5).getStart(this.sourceFile),
            );
        } else {
            closeBraceFix = Lint.Replacement.deleteFromTo(block.statements.end, block.end);
        }
        this.addFailure(block.statements.pos - 1, block.end, FAIL_MESSAGE_UNNECESSARY, [
            Lint.Replacement.deleteFromTo(block.pos, block.statements.pos),
            closeBraceFix,
        ]);
    }
}

function getElseIfParent(node: ts.Node): ts.IfStatement | undefined {
    let parent = node.parent!;
    if (parent.kind === ts.SyntaxKind.Block && (<ts.Block>parent).statements.length === 1) {
        node = parent;
        parent = node.parent!;
    }
    if (parent.kind === ts.SyntaxKind.IfStatement && (<ts.IfStatement>parent).elseStatement === node)
        return <ts.IfStatement>parent;
}

function unwrapBlock(node: ts.Statement): ts.Statement {
    while (utils.isBlock(node) && node.statements.length === 1)
        node = node.statements[0];
    return node;
}