import Fixture from "./helpers/Fixture"
import {functionSig} from "../../utils/helpers"
import {assert} from "chai"
import {ethers, web3} from "hardhat"
import chai from "chai"
import {solidity} from "ethereum-waffle"

chai.use(solidity)
const {expect} = chai

describe("BondingCheckpoints", () => {
    let signers
    let fixture

    let bondingCheckpoints

    const PERC_DIVISOR = 1000000

    const setRound = async round => {
        await fixture.roundsManager.setMockUint256(
            functionSig("currentRound()"),
            round
        )
    }

    before(async () => {
        signers = await ethers.getSigners()
        fixture = new Fixture(web3)
        await fixture.deploy()

        const bondingCheckpointsFac = await ethers.getContractFactory(
            "BondingCheckpoints"
        )

        bondingCheckpoints = await fixture.deployAndRegister(
            bondingCheckpointsFac,
            "BondingCheckpoints",
            fixture.controller.address
        )
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("IERC6372Upgradeable", () => {
        describe("clock", () => {
            let currentRound

            beforeEach(async () => {
                currentRound = 100

                await setRound(currentRound)
            })

            it("should return the current round", async () => {
                assert.equal(await bondingCheckpoints.clock(), currentRound)

                await setRound(currentRound + 7)

                assert.equal(await bondingCheckpoints.clock(), currentRound + 7)
            })
        })

        describe("CLOCK_MODE", () => {
            it("should return mode=livepeer_round", async () => {
                assert.equal(
                    await bondingCheckpoints.CLOCK_MODE(),
                    "mode=livepeer_round"
                )
            })
        })
    })

    const encodeCheckpointBondingState = ({
        account,
        startRound,
        bondedAmount,
        delegateAddress,
        delegatedAmount,
        lastClaimRound,
        lastRewardRound
    }) => {
        return bondingCheckpoints.interface.encodeFunctionData(
            "checkpointBondingState",
            [
                account,
                startRound,
                bondedAmount,
                delegateAddress,
                delegatedAmount,
                lastClaimRound,
                lastRewardRound
            ]
        )
    }

    const encodeCheckpointTotalActiveStake = (totalStake, round) => {
        return bondingCheckpoints.interface.encodeFunctionData(
            "checkpointTotalActiveStake",
            [totalStake, round]
        )
    }

    describe("checkpointTotalActiveStake", () => {
        let currentRound

        beforeEach(async () => {
            currentRound = 100

            await setRound(currentRound)
        })

        it("should fail if BondingManager is not the caller", async () => {
            const tx = bondingCheckpoints
                .connect(signers[2])
                .checkpointTotalActiveStake(1337, currentRound)
            await expect(tx).to.be.revertedWith("caller must be BondingManager")
        })

        it("should fail if checkpointing after current round", async () => {
            const functionData = encodeCheckpointTotalActiveStake(
                1337,
                currentRound + 1
            )

            await expect(
                fixture.bondingManager.execute(
                    bondingCheckpoints.address,
                    functionData
                )
            ).to.be.revertedWith(
                "can only checkpoint total active stake in the current round"
            )
        })

        it("should allow checkpointing in the current round", async () => {
            const functionData = encodeCheckpointTotalActiveStake(
                1337,
                currentRound
            )

            await fixture.bondingManager.execute(
                bondingCheckpoints.address,
                functionData
            )

            assert.equal(
                await bondingCheckpoints.getTotalActiveStakeAt(currentRound),
                1337
            )
        })
    })

    describe("getTotalActiveStakeAt", () => {
        let currentRound

        beforeEach(async () => {
            currentRound = 100

            await setRound(currentRound)
        })

        it("should fail if round is in the future", async () => {
            const tx = bondingCheckpoints.getTotalActiveStakeAt(
                currentRound + 1
            )
            await expect(tx).to.be.revertedWith(
                "getTotalActiveStakeAt: future lookup"
            )
        })

        it("should fail if round was not checkpointed", async () => {
            const tx = bondingCheckpoints.getTotalActiveStakeAt(currentRound)
            await expect(tx).to.be.revertedWith("findLowerBound: empty array")
        })

        it("should query checkpointed value in the current round", async () => {
            const functionData = encodeCheckpointTotalActiveStake(
                1337,
                currentRound
            )
            await fixture.bondingManager.execute(
                bondingCheckpoints.address,
                functionData
            )

            assert.equal(
                await bondingCheckpoints.getTotalActiveStakeAt(currentRound),
                1337
            )
        })

        it("should allow querying the past checkpointed values", async () => {
            const roundStakes = [
                [500, currentRound - 5],
                [1000, currentRound - 4],
                [1500, currentRound - 3],
                [2000, currentRound - 2],
                [2500, currentRound - 1]
            ]

            for (const [totalStake, round] of roundStakes) {
                const functionData = encodeCheckpointTotalActiveStake(
                    totalStake,
                    round
                )
                await fixture.bondingManager.execute(
                    bondingCheckpoints.address,
                    functionData
                )
            }

            // now check all past values that must be recorded
            for (const [expectedStake, round] of roundStakes) {
                assert.equal(
                    await bondingCheckpoints.getTotalActiveStakeAt(round),
                    expectedStake
                )
            }
        })
    })

    describe("checkpointBondingState", () => {
        let transcoder
        let currentRound

        beforeEach(async () => {
            transcoder = signers[0]
            currentRound = 100

            await setRound(currentRound)
        })

        it("should fail if BondingManager is not the caller", async () => {
            const tx = bondingCheckpoints
                .connect(signers[2])
                .checkpointBondingState(
                    transcoder.address,
                    currentRound + 1,
                    1000,
                    transcoder.address,
                    1000,
                    currentRound,
                    0
                )
            await expect(tx).to.be.revertedWith("caller must be BondingManager")
        })

        it("should fail if checkpointing after next round", async () => {
            const functionData = encodeCheckpointBondingState({
                account: transcoder.address,
                startRound: currentRound + 2,
                bondedAmount: 1000,
                delegateAddress: transcoder.address,
                delegatedAmount: 1000,
                lastClaimRound: currentRound + 1,
                lastRewardRound: 0
            })

            await expect(
                fixture.bondingManager.execute(
                    bondingCheckpoints.address,
                    functionData
                )
            ).to.be.revertedWith(
                "can only checkpoint delegator up to the next round"
            )
        })

        it("should allow checkpointing in the next round", async () => {
            const functionData = encodeCheckpointBondingState({
                account: transcoder.address,
                startRound: currentRound,
                bondedAmount: 1000,
                delegateAddress: transcoder.address,
                delegatedAmount: 1000,
                lastClaimRound: currentRound - 1,
                lastRewardRound: 0
            })
            await fixture.bondingManager.execute(
                bondingCheckpoints.address,
                functionData
            )
        })

        it("should checkpoint account state", async () => {
            const functionData = encodeCheckpointBondingState({
                account: transcoder.address,
                startRound: currentRound,
                bondedAmount: 1000,
                delegateAddress: transcoder.address,
                delegatedAmount: 1000,
                lastClaimRound: currentRound - 1,
                lastRewardRound: 0
            })
            await fixture.bondingManager.execute(
                bondingCheckpoints.address,
                functionData
            )

            assert.deepEqual(
                await bondingCheckpoints
                    .getBondingStateAt(transcoder.address, currentRound)
                    .then(t => t.map(v => v.toString())),
                ["1000", transcoder.address]
            )
        })

        it("should be callable multiple times for the same round", async () => {
            const makeCheckpoint = async amount => {
                const functionData = encodeCheckpointBondingState({
                    account: transcoder.address,
                    startRound: currentRound + 1,
                    bondedAmount: amount,
                    delegateAddress: transcoder.address,
                    delegatedAmount: amount,
                    lastClaimRound: currentRound,
                    lastRewardRound: 0
                })
                await fixture.bondingManager.execute(
                    bondingCheckpoints.address,
                    functionData
                )
            }

            await makeCheckpoint(1000)

            // simulating a bond where bonding manager checkpoints the current state and then the next
            await makeCheckpoint(2000)

            await setRound(currentRound + 1)

            assert.deepEqual(
                await bondingCheckpoints
                    .getBondingStateAt(transcoder.address, currentRound + 1)
                    .then(t => t.map(v => v.toString())),
                ["2000", transcoder.address]
            )
        })
    })

    describe("hasCheckpoint", () => {
        let transcoder
        let currentRound

        beforeEach(async () => {
            transcoder = signers[0]
            currentRound = 100

            await setRound(currentRound)

            // await fixture.bondingManager.setMockTranscoderEarningsPoolForRound(
            //     transcoder.address,
            //     currentRound,
            //     1000,
            //     0,
            //     0,
            //     PERC_DIVISOR, // 1
            //     0
            // )
        })

        it("should return false for accounts without checkpoints", async () => {
            for (let i = 0; i < 10; i++) {
                assert.equal(
                    await bondingCheckpoints.hasCheckpoint(signers[i].address),
                    false
                )
            }
        })

        it("should return true after one or more checkpoints are made", async () => {
            const makeCheckpoint = async startRound => {
                const functionData = encodeCheckpointBondingState({
                    account: transcoder.address,
                    startRound,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    delegatedAmount: 1000,
                    lastClaimRound: startRound - 1,
                    lastRewardRound: 0
                })
                await fixture.bondingManager.execute(
                    bondingCheckpoints.address,
                    functionData
                )
            }

            for (let i = 0; i < 3; i++) {
                const round = currentRound + i
                await setRound(round)

                await makeCheckpoint(round + 1)

                assert.equal(
                    await bondingCheckpoints.hasCheckpoint(transcoder.address),
                    true
                )
            }
        })
    })

    describe("getBondingStateAt", () => {
        let transcoder
        let delegator
        let currentRound

        beforeEach(async () => {
            transcoder = signers[0]
            delegator = signers[1]
            currentRound = 100

            await setRound(currentRound)
        })

        it("should fail if round is in the future", async () => {
            const tx = bondingCheckpoints.getBondingStateAt(
                delegator.address,
                currentRound + 1
            )
            await expect(tx).to.be.revertedWith(
                "getBondingCheckpointAt: future lookup"
            )
        })

        describe("for transcoder", () => {
            const makeCheckpoint = async (startRound, delegatedAmount) => {
                const functionData = encodeCheckpointBondingState({
                    account: transcoder.address,
                    startRound,
                    bondedAmount: 1, // doesn't matter, shouldn't be used
                    delegateAddress: transcoder.address,
                    delegatedAmount,
                    lastClaimRound: startRound - 1,
                    lastRewardRound: 0
                })
                await fixture.bondingManager.execute(
                    bondingCheckpoints.address,
                    functionData
                )
            }

            it("should disallow querying before the first checkpoint", async () => {
                await makeCheckpoint(currentRound, 1000)

                const tx = bondingCheckpoints.getBondingStateAt(
                    transcoder.address,
                    currentRound - 2
                )
                await expect(tx).to.be.revertedWith(
                    "findLowerBound: all values in array are higher than searched value"
                )
            })

            it("should return the same round delegatedAmount and own address", async () => {
                await makeCheckpoint(currentRound, 1000)

                assert.deepEqual(
                    await bondingCheckpoints
                        .getBondingStateAt(transcoder.address, currentRound)
                        .then(t => t.map(v => v.toString())),
                    ["1000", transcoder.address]
                )
            })

            it("should return the last checkpoint before the queried round", async () => {
                await makeCheckpoint(currentRound - 10, 1000)
                await makeCheckpoint(currentRound - 5, 2000)

                assert.deepEqual(
                    await bondingCheckpoints
                        .getBondingStateAt(transcoder.address, currentRound - 7)
                        .then(t => t.map(v => v.toString())),
                    ["1000", transcoder.address]
                )

                assert.deepEqual(
                    await bondingCheckpoints
                        .getBondingStateAt(transcoder.address, currentRound)
                        .then(t => t.map(v => v.toString())),
                    ["2000", transcoder.address]
                )
            })
        })

        describe("for delegator", () => {
            let transcoder2

            const checkpointTranscoder = async ({
                account,
                startRound,
                lastRewardRound
            }) => {
                const functionData = encodeCheckpointBondingState({
                    account,
                    startRound,
                    bondedAmount: 0, // not used in these tests
                    delegateAddress: account,
                    delegatedAmount: 0, // not used in these tests
                    lastClaimRound: 0, // not used in these tests
                    lastRewardRound
                })
                await fixture.bondingManager.execute(
                    bondingCheckpoints.address,
                    functionData
                )
            }

            const setEarningPoolRewardFactor = async (
                address,
                round,
                factor
            ) => {
                await fixture.bondingManager.setMockTranscoderEarningsPoolForRound(
                    address,
                    round,
                    0,
                    0,
                    0,
                    factor,
                    0
                )
            }

            const checkpointDelegator = async ({
                startRound,
                bondedAmount,
                delegateAddress,
                lastClaimRound
            }) => {
                const functionData = encodeCheckpointBondingState({
                    account: delegator.address,
                    startRound,
                    bondedAmount,
                    delegateAddress,
                    delegatedAmount: 0, // not used for delegators
                    lastClaimRound,
                    lastRewardRound: 0 // not used for delegators
                })
                await fixture.bondingManager.execute(
                    bondingCheckpoints.address,
                    functionData
                )
            }

            beforeEach(async () => {
                transcoder2 = signers[2]

                currentRound = 200

                await setRound(currentRound)

                await checkpointTranscoder({
                    account: transcoder.address,
                    startRound: currentRound - 100,
                    lastRewardRound: 0
                })
                await checkpointTranscoder({
                    account: transcoder2.address,
                    startRound: currentRound - 100,
                    lastRewardRound: 0
                })
            })

            it("should disallow querying before the first checkpoint", async () => {
                await checkpointDelegator({
                    startRound: currentRound,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    lastClaimRound: currentRound - 1
                })

                const tx = bondingCheckpoints.getBondingStateAt(
                    delegator.address,
                    currentRound - 2
                )
                await expect(tx).to.be.revertedWith(
                    "findLowerBound: all values in array are higher than searched value"
                )
            })

            it("should fail if there's no earning pool on the lastClaimRound", async () => {
                await checkpointDelegator({
                    startRound: currentRound,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    lastClaimRound: currentRound - 11
                })

                const tx = bondingCheckpoints.getBondingStateAt(
                    delegator.address,
                    currentRound
                )
                await expect(tx).to.be.revertedWith(
                    "missing earning pool from delegator's last claim round"
                )
            })

            it("should return the bonded amount if transcoder never called reward", async () => {
                await checkpointDelegator({
                    startRound: currentRound - 10,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    lastClaimRound: currentRound - 11
                })
                await setEarningPoolRewardFactor(
                    transcoder.address,
                    currentRound - 11,
                    PERC_DIVISOR
                )

                assert.deepEqual(
                    await bondingCheckpoints
                        .getBondingStateAt(delegator.address, currentRound)
                        .then(t => t.map(v => v.toString())),
                    ["1000", transcoder.address]
                )
            })

            it("should return the last checkpoint before the queried round", async () => {
                await checkpointDelegator({
                    startRound: currentRound - 10,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    lastClaimRound: currentRound - 11
                })
                await setEarningPoolRewardFactor(
                    transcoder.address,
                    currentRound - 11,
                    PERC_DIVISOR
                )

                await checkpointDelegator({
                    startRound: currentRound - 5,
                    bondedAmount: 2000,
                    delegateAddress: transcoder2.address,
                    lastClaimRound: currentRound - 6
                })
                await setEarningPoolRewardFactor(
                    transcoder2.address,
                    currentRound - 6,
                    PERC_DIVISOR
                )

                assert.deepEqual(
                    await bondingCheckpoints
                        .getBondingStateAt(delegator.address, currentRound - 7)
                        .then(t => t.map(v => v.toString())),
                    ["1000", transcoder.address]
                )

                assert.deepEqual(
                    await bondingCheckpoints
                        .getBondingStateAt(delegator.address, currentRound)
                        .then(t => t.map(v => v.toString())),
                    ["2000", transcoder2.address]
                )
            })

            it("should return the same bonded amount if transcoder last called reward before claim round", async () => {
                await checkpointTranscoder({
                    account: transcoder.address,
                    startRound: currentRound,
                    lastRewardRound: currentRound - 10
                })
                await setEarningPoolRewardFactor(
                    transcoder.address,
                    currentRound - 10,
                    PERC_DIVISOR
                )

                await checkpointDelegator({
                    startRound: currentRound,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    lastClaimRound: currentRound - 1
                })
                await setEarningPoolRewardFactor(
                    transcoder.address,
                    currentRound - 1,
                    2 * PERC_DIVISOR
                )

                assert.deepEqual(
                    await bondingCheckpoints
                        .getBondingStateAt(delegator.address, currentRound)
                        .then(t => t.map(v => v.toString())),
                    ["1000", transcoder.address]
                )
            })

            it("should return the bonded amount with accrued pending rewards since lastClaimRound", async () => {
                await checkpointDelegator({
                    startRound: currentRound - 9,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    lastClaimRound: currentRound - 10
                })
                await setEarningPoolRewardFactor(
                    transcoder.address,
                    currentRound - 10,
                    PERC_DIVISOR
                )

                await checkpointTranscoder({
                    account: transcoder.address,
                    startRound: currentRound - 1,
                    lastRewardRound: currentRound - 2
                })
                await setEarningPoolRewardFactor(
                    transcoder.address,
                    currentRound - 2,
                    3 * PERC_DIVISOR
                )

                assert.deepEqual(
                    await bondingCheckpoints
                        .getBondingStateAt(delegator.address, currentRound)
                        .then(t => t.map(v => v.toString())),
                    ["3000", transcoder.address]
                )
            })
        })
    })
})
